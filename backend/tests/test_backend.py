import csv
import io

import pytest

from app.csv_import import CsvFormatError, parse_manabox_csv
from app.importer import compute_diff
from conftest import fake_card

HEADER = [
    "Binder Name", "Binder Type", "Name", "Set code", "Set name", "Collector number", "Foil", "Rarity",
    "Quantity", "ManaBox ID", "Scryfall ID", "Purchase price", "Misprint", "Altered", "Signed",
    "Condition", "Language", "Proxy", "Purchase price currency", "Added",
]

ID_A = "00000000-0000-0000-0000-00000000000a"
ID_B = "00000000-0000-0000-0000-00000000000b"
ID_B2 = "00000000-0000-0000-0000-0000000000b2"
ID_C = "00000000-0000-0000-0000-00000000000c"


def make_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER)
    w.writeheader()
    for r in rows:
        base = {h: "" for h in HEADER}
        base.update({"Binder Type": "binder", "Foil": "normal", "Rarity": "common", "Misprint": "false",
                     "Altered": "false", "Signed": "false", "Condition": "near_mint", "Language": "en",
                     "Proxy": "false", "Purchase price currency": "EUR"})
        base.update(r)
        w.writerow(base)
    return buf.getvalue().encode()


def row(name, sid, binder="binder A", qty=1, set_code="TST", number="1", price="1.00", foil="normal"):
    return {"Name": name, "Scryfall ID": sid, "Binder Name": binder, "Quantity": str(qty),
            "Set code": set_code, "Collector number": number, "Purchase price": price, "Foil": foil}


# --- CSV ---------------------------------------------------------------------------------

def test_parse_csv_normalises_values():
    rows = parse_manabox_csv(make_csv([row("Opt", ID_A, qty=3, price="0.25", foil="foil")]))
    assert rows[0]["quantity"] == 3
    assert rows[0]["purchase_price"] == 0.25
    assert rows[0]["finish"] == "foil"
    assert rows[0]["proxy"] == 0


def test_parse_csv_rejects_other_formats():
    with pytest.raises(CsvFormatError, match="colonne mancanti"):
        parse_manabox_csv(b"foo,bar\n1,2\n")


def test_parse_real_export_header_with_bom():
    content = "﻿".encode() + make_csv([row("Opt", ID_A)])
    assert parse_manabox_csv(content)[0]["name"] == "Opt"


# --- diff --------------------------------------------------------------------------------

def test_diff_detects_added_removed_changed():
    def r(name, sid, qty, binder="A"):
        return {"name": name, "scryfall_id": sid, "binder_name": binder, "finish": "normal", "language": "en",
                "set_code": "TST", "collector_number": "1", "quantity": qty}

    prev = [r("Opt", ID_A, 2), r("Bolt", ID_B, 1)]
    cur = [r("Opt", ID_A, 3), r("Shock", ID_C, 1)]
    diff = compute_diff(prev, cur)
    assert [d["name"] for d in diff["added"]] == ["Shock"]
    assert [d["name"] for d in diff["removed"]] == ["Bolt"]
    assert diff["changed"][0]["before"] == 2 and diff["changed"][0]["after"] == 3
    assert diff["summary"] == {"added_copies": 2, "removed_copies": 1}


# --- import + enrichment -------------------------------------------------------------------

def upload(api, rows):
    return api.post("/api/imports", files={"file": ("export.csv", make_csv(rows), "text/csv")})


def test_import_enriches_and_falls_back_to_set_number(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    # The CSV has a stale id for Bolt; it must be resolved through set + collector number.
    fake_scryfall.add(fake_card(ID_B2, "Lightning Bolt", set_code="clu", number="80"))
    resp = upload(api, [row("Opt", ID_A, qty=2), row("Lightning Bolt", ID_B, set_code="CLU", number="80")])
    assert resp.status_code == 201

    status = api.get("/api/status").json()
    assert status["current_import"]["status"] == "ready"
    assert status["current_import"]["total_quantity"] == 3

    data = api.get("/api/collection").json()
    assert {r["scryfall_id"] for r in data["rows"]} == {ID_A, ID_B2}
    assert data["cards"][ID_A]["mana_cost"] == "{1}{U}"
    assert data["cards"][ID_A]["legal"] == ["legacy"]


def test_import_batches_requests_of_75(api, fake_scryfall):
    rows = []
    for i in range(80):
        cid = f"00000000-0000-0000-0000-{i:012d}"
        fake_scryfall.add(fake_card(cid, f"Card {i}", number=str(i)))
        rows.append(row(f"Card {i}", cid, number=str(i)))
    upload(api, rows)
    assert fake_scryfall.calls.count("POST /cards/collection") == 2


def test_second_import_produces_diff_and_replaces_rows(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_C, "Shock", number="3"))
    upload(api, [row("Opt", ID_A)])
    second = upload(api, [row("Opt", ID_A, qty=2), row("Shock", ID_C, number="3")]).json()["id"]
    diff = api.get(f"/api/imports/{second}/diff").json()
    assert diff["summary"]["added_copies"] == 2
    assert len(api.get("/api/collection").json()["rows"]) == 2


def test_invalid_csv_returns_422(api):
    resp = api.post("/api/imports", files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")})
    assert resp.status_code == 422


# --- images --------------------------------------------------------------------------------

def test_image_is_downloaded_once_and_cached(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    first = api.get(f"/api/images/{ID_A}?size=normal")
    second = api.get(f"/api/images/{ID_A}?size=normal")
    assert first.status_code == 200 and second.content == first.content
    assert sum(1 for c in fake_scryfall.calls if c.endswith(".jpg")) == 1


# --- lists ---------------------------------------------------------------------------------

def test_lists_bulk_ownership_and_export(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232", colors=[], mana_cost="{0}", cmc=0.0))
    upload(api, [row("Opt", ID_A, qty=3)])

    cube = api.post("/api/lists", json={"name": "Cubo", "kind": "cube"}).json()
    other = api.post("/api/lists", json={"name": "Altro"}).json()

    applied = api.post(f"/api/lists/{cube['id']}/items/bulk", json={"items": [
        {"scryfall_id": ID_A, "quantity": 2},
        {"scryfall_id": ID_C, "quantity": 1},
    ]}).json()["applied"]
    assert [a["delta"] for a in applied] == [2, 1]
    api.post(f"/api/lists/{other['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 1}]})

    items = {i["card"]["name"]: i for i in api.get(f"/api/lists/{cube['id']}").json()["items"]}
    assert items["Opt"]["ownership"] == "owned"
    assert items["Opt"]["owned"] == 3 and items["Opt"]["used_elsewhere"] == 1
    assert items["Black Lotus"]["ownership"] == "not_owned"

    # Adding more copies sums up; undo with a negative delta.
    api.post(f"/api/lists/{cube['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 2}]})
    items = {i["card"]["name"]: i for i in api.get(f"/api/lists/{cube['id']}").json()["items"]}
    assert items["Opt"]["quantity"] == 4 and items["Opt"]["ownership"] == "partial"
    api.post(f"/api/lists/{cube['id']}/items/bulk", json={"items": [{"scryfall_id": ID_C, "quantity": -5}]})
    names = [i["card"]["name"] for i in api.get(f"/api/lists/{cube['id']}").json()["items"]]
    assert names == ["Opt"]

    csv_text = api.get(f"/api/lists/{cube['id']}/export?format=cubecobra_csv").text
    lines = csv_text.strip().splitlines()
    assert lines[0].startswith("name,CMC,Type,Color,Set")
    assert len(lines) == 1 + 4  # one row per copy

    txt = api.get(f"/api/lists/{cube['id']}/export?format=txt").text
    assert txt == "4 Opt (TST) 1\n"

    assert api.get("/api/lists/usage").json()[items["Opt"]["oracle_id"]] == {str(cube["id"]): 4, str(other["id"]): 1}
