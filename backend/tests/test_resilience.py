"""Scryfall outages, concurrent imports and input validation."""

import httpx
import pytest

from app import db, importer, scryfall
from app.csv_import import parse_manabox_csv
from conftest import fake_card
from test_backend import ID_A, ID_B, ID_B2, ID_C, make_csv, row, upload


# --- Scryfall client retries -----------------------------------------------------------------

def test_client_retries_server_errors_and_network_failures(fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.failures = [503, httpx.ConnectError("boom"), 429]
    assert scryfall.get_client().card(ID_A)["name"] == "Opt"
    assert len(fake_scryfall.calls) == 4


def test_client_gives_up_with_a_scryfall_error(fake_scryfall):
    fake_scryfall.down = httpx.ReadTimeout("slow")
    with pytest.raises(scryfall.ScryfallError, match="unreachable"):
        scryfall.get_client().card(ID_A)
    assert len(fake_scryfall.calls) == 6  # 1 + 5 retries


def test_unanswered_requests_are_502_not_500(api, fake_scryfall):
    fake_scryfall.down = 500
    assert api.get(f"/api/cards/{ID_A}").status_code == 502
    assert api.get("/api/scryfall/autocomplete?q=opt").json() == []
    fake_scryfall.down = None
    assert api.get(f"/api/cards/{ID_A}").status_code == 404


def test_card_ids_are_validated(api, fake_scryfall):
    assert api.get("/api/cards/named%3Fexact%3DOpt").status_code == 404
    assert fake_scryfall.calls == []


# --- imports during an outage ---------------------------------------------------------------

def test_import_survives_an_outage_and_retry_fetches_the_rest(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_C, "Shock", number="3"))
    fake_scryfall.down = 503
    upload(api, [row("Opt", ID_A, qty=2), row("Shock", ID_C, number="3")])

    status = api.get("/api/status").json()
    assert status["current_import"]["status"] == "ready"
    assert status["pending_cards"] == 2
    rows = api.get("/api/collection").json()["rows"]
    assert {r["scryfall_id"] for r in rows} == {ID_A, ID_C}  # ids kept, not discarded as unknown

    fake_scryfall.down = None
    importer.retry_pending()
    status = api.get("/api/status").json()
    assert status["pending_cards"] == 0 and status["retry"]["error"] is None
    assert set(api.get("/api/collection").json()["cards"]) == {ID_A, ID_C}


def test_outage_during_the_fallback_keeps_the_row(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_B2, "Lightning Bolt", set_code="clu", number="80"))
    # the by-id lookup answers "not found", then the set + number fallback hits the outage
    fake_scryfall.failures = [None]
    fake_scryfall.down = 503
    upload(api, [row("Lightning Bolt", ID_B, set_code="CLU", number="80")])
    assert api.get("/api/status").json()["pending_cards"] == 1

    fake_scryfall.down = None
    importer.retry_pending()
    assert {r["scryfall_id"] for r in api.get("/api/collection").json()["rows"]} == {ID_B2}


def test_price_refresh_skips_unanswered_batches(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    upload(api, [row("Opt", ID_A)])
    fake_scryfall.down = 503
    importer.refresh_prices()
    assert importer.price_job["status"] == "idle"
    assert "did not answer for 1 of 1" in importer.price_job["error"]


def test_interrupted_import_is_resumed(fake_scryfall, monkeypatch):
    started = []
    monkeypatch.setattr(importer, "start_enrichment", started.append)
    with db.session() as conn:
        older = importer.create_import(conn, "old.csv", [_parsed("Opt", ID_A)])
        latest = conn.execute(
            "INSERT INTO imports (filename, imported_at, row_count, total_quantity, status) VALUES ('x', '', 0, 0, 'enriching')"
        ).lastrowid
    importer.resume_after_restart()
    assert started == [latest]  # only the latest interrupted import is resumed
    with db.session() as conn:
        assert conn.execute("SELECT status FROM imports WHERE id = ?", (older,)).fetchone()[0] == "error"
        assert conn.execute("SELECT COUNT(*) FROM collection_rows WHERE import_id = ?", (older,)).fetchone()[0] == 0


def _parsed(name, sid):
    return parse_manabox_csv(make_csv([row(name, sid)]))[0]


# --- concurrency and diff ----------------------------------------------------------------------

def test_a_second_import_is_refused_while_one_runs(fake_scryfall):
    with db.session() as conn:
        importer.create_import(conn, "a.csv", [_parsed("Opt", ID_A)])
        with pytest.raises(importer.ImportRunning):
            importer.create_import(conn, "b.csv", [_parsed("Opt", ID_A)])


def test_reimporting_a_file_with_a_corrected_id_shows_no_changes(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_B2, "Lightning Bolt", set_code="clu", number="80"))
    rows = [row("Lightning Bolt", ID_B, set_code="CLU", number="80")]
    upload(api, rows)
    second = upload(api, rows).json()["id"]
    diff = api.get(f"/api/imports/{second}/diff").json()
    assert diff["added"] == [] and diff["removed"] == [] and diff["changed"] == []


# --- validation ------------------------------------------------------------------------------

def test_list_names_are_one_non_blank_line(api):
    assert api.post("/api/lists", json={"name": "X\n4 Black Lotus (TST) 2"}).status_code == 422
    assert api.post("/api/lists", json={"name": "   "}).status_code == 422
    created = api.post("/api/lists", json={"name": "  Cubo  "}).json()
    assert created["name"] == "Cubo"
    assert api.patch(f"/api/lists/{created['id']}", json={"name": " "}).status_code == 422


def test_bulk_quantities_are_bounded(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    lst = api.post("/api/lists", json={"name": "L"}).json()
    url = f"/api/lists/{lst['id']}/items/bulk"
    assert api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": 200000}]}).status_code == 422
    api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": 999}]})
    applied = api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": 5}]}).json()["applied"]
    assert applied == []  # already at the maximum
    assert api.get(f"/api/lists/{lst['id']}").json()["items"][0]["quantity"] == 999
