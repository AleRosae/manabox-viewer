import csv
import io

import pytest

from app.csv_import import CsvFormatError, parse_manabox_csv
from app.importer import compute_diff
from app.cubecobra import parse_cube_ref
from app.exporters import copy_statuses
from app.list_import import normalize_tags, parse_list_text
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
    with pytest.raises(CsvFormatError, match="missing columns"):
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


# --- list sharing ----------------------------------------------------------------------------

def test_parse_list_text_variants():
    meta, lines, invalid = parse_list_text(
        "﻿# ManaBox Viewer list v1\n# name: Pauper Cube\n# kind: cube\n\n"
        "2 Lightning Bolt (2X2) 117 | owned 1\n1x Counterspell\nOpt\nSideboard\n"
        "Fire // Ice (MH2) 290 *F*\n"
    )
    assert meta == {"name": "Pauper Cube", "kind": "cube"}
    assert invalid == []
    assert [(l.quantity, l.name, l.set_code, l.collector_number, l.owned) for l in lines] == [
        (2, "Lightning Bolt", "2x2", "117", 1),
        (1, "Counterspell", None, None, None),
        (1, "Opt", None, None, None),
        (1, "Fire // Ice", "mh2", "290", None),
    ]


def _share_setup(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_B, "Counterspell", number="2"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232"))
    upload(api, [row("Opt", ID_A, qty=3), row("Counterspell", ID_B, qty=1, number="2")])


def test_list_import_preview_resolves_and_compares(api, fake_scryfall):
    _share_setup(api, fake_scryfall)
    text = (
        "# name: Friend cube\n# kind: cube\n"
        "2 Opt (TST) 1 | owned 2\n"
        "2 Counterspell (XXX) 9 | owned 0\n"   # wrong print: resolved by name
        "1 Black Lotus | owned 1\n"
        "1 Opt | owned 0\n"                     # duplicate: merged
        "1 Lotus Blac | owned 0\n"              # unknown even fuzzily
    )
    body = api.post("/api/lists/import/preview", json={"text": text}).json()
    assert body["meta"] == {"name": "Friend cube", "kind": "cube", "has_ownership": True}
    items = {i["card"]["name"]: i for i in body["items"]}
    assert (items["Opt"]["quantity"], items["Opt"]["owned"], items["Opt"]["their_owned"]) == (3, 3, 2)
    assert items["Counterspell"]["ownership"] == "partial"
    assert items["Black Lotus"]["ownership"] == "not_owned" and items["Black Lotus"]["their_owned"] == 1
    assert body["unresolved"] == ["1 Lotus Blac | owned 0"]


def test_list_import_and_viewer_round_trip(api, fake_scryfall):
    _share_setup(api, fake_scryfall)
    created = api.post("/api/lists/import", json={
        "name": "Friend cube", "kind": "cube", "shared_by": "Marco",
        "items": [{"scryfall_id": ID_A, "quantity": 2, "their_owned": 5},
                  {"scryfall_id": ID_C, "quantity": 1, "their_owned": 1}],
    }).json()
    assert created["shared_by"] == "Marco"
    detail = api.get(f"/api/lists/{created['id']}").json()
    assert {i["card"]["name"]: i["their_owned"] for i in detail["items"]} == {"Opt": 2, "Black Lotus": 1}

    exported = api.get(f"/api/lists/{created['id']}/export?format=viewer").text
    assert exported.startswith("# ManaBox Viewer list v1\n# name: Friend cube\n# kind: cube\n")
    # The export carries *my* ownership: 3 Opt owned (capped to 2), no Black Lotus.
    assert "2 Opt (TST) 1 | owned 2" in exported and "1 Black Lotus (TST) 232 | owned 0" in exported
    back = api.post("/api/lists/import/preview", json={"text": exported}).json()
    assert {i["card"]["name"]: (i["quantity"], i["their_owned"]) for i in back["items"]} == {
        "Opt": (2, 2), "Black Lotus": (1, 0)}

    missing = api.get(f"/api/lists/{created['id']}/export?format=missing").text
    assert missing == "1 Black Lotus (TST) 232\n"


def test_viewer_format_carries_tags(api, fake_scryfall):
    _share_setup(api, fake_scryfall)
    created = api.post("/api/lists/import", json={
        "name": "Tagged", "kind": "cube",
        "items": [{"scryfall_id": ID_A, "quantity": 1, "tags": ["Blue", "Cantrip"]},
                  {"scryfall_id": ID_A, "quantity": 1, "tags": ["cantrip", "Tempo"]}],
    }).json()
    [item] = api.get(f"/api/lists/{created['id']}").json()["items"]
    assert (item["quantity"], item["tags"]) == (2, ["Blue", "Cantrip", "Tempo"])
    exported = api.get(f"/api/lists/{created['id']}/export?format=viewer").text
    assert "2 Opt (TST) 1 | owned 2 | tags: Blue; Cantrip; Tempo" in exported
    back = api.post("/api/lists/import/preview", json={"text": exported}).json()
    assert back["items"][0]["tags"] == ["Blue", "Cantrip", "Tempo"]


# --- tags & CubeCobra ---------------------------------------------------------------------------

def test_normalize_tags_and_cube_refs():
    assert normalize_tags([" Aggro ", "aggro", "", "Burn;Red", "x" * 50]) == ["Aggro", "Burn Red", "x" * 40]
    assert normalize_tags("Burn") == ["Burn"]
    assert normalize_tags(['=HYPERLINK("x")', "@me", "+2"]) == ['HYPERLINK("x")', "me", "2"]
    assert parse_cube_ref("https://cubecobra.com/cube/list/vintagecube?view=table") == "vintagecube"
    assert parse_cube_ref("cubecobra.com/cube/overview/5d9bde692336c66ef4b21f5c") == "5d9bde692336c66ef4b21f5c"
    assert parse_cube_ref("  mycube ") == "mycube"
    assert parse_cube_ref("https://example.com/not a cube") is None


def test_item_tags_patch_and_cubecobra_export(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    lst = api.post("/api/lists", json={"name": "Cubo", "kind": "cube"}).json()
    api.post(f"/api/lists/{lst['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 2}]})
    [item] = api.get(f"/api/lists/{lst['id']}").json()["items"]
    assert item["tags"] == []
    api.patch(f"/api/lists/{lst['id']}/items/{item['id']}", json={"tags": ["Cantrip", " cantrip", "Blue"]})
    [item] = api.get(f"/api/lists/{lst['id']}").json()["items"]
    assert item["tags"] == ["Cantrip", "Blue"]

    rows = list(csv.DictReader(io.StringIO(api.get(f"/api/lists/{lst['id']}/export?format=cubecobra_csv").text)))
    assert len(rows) == 2
    assert (rows[0]["tags"], rows[0]["board"], rows[0]["status"]) == ("Cantrip;Blue", "mainboard", "Not Owned")


def _cube_setup(api, fake_scryfall, fake_cubecobra):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_B, "Counterspell", number="2"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232", rarity="rare"))
    upload(api, [row("Opt", ID_A, qty=1)])
    fake_cubecobra.add("mycube", "My Cube", [
        (ID_A, ["Cantrip"]), (ID_A, ["Blue"]),     # two copies: merged, tags united
        (ID_C, []),
        ("custom-card", ["Custom"]),               # not a Scryfall card
    ])


def test_cubecobra_preview_and_linked_import(api, fake_scryfall, fake_cubecobra):
    _cube_setup(api, fake_scryfall, fake_cubecobra)
    body = api.post("/api/lists/cubecobra/preview", json={"url": "https://cubecobra.com/cube/list/mycube"}).json()
    assert body["meta"] == {"name": "My Cube", "kind": "cube", "has_ownership": False, "cubecobra_id": "mycube"}
    items = {i["card"]["name"]: i for i in body["items"]}
    assert (items["Opt"]["quantity"], items["Opt"]["ownership"], items["Opt"]["tags"]) == (2, "partial", ["Cantrip", "Blue"])
    assert items["Black Lotus"]["ownership"] == "not_owned"
    assert body["unresolved"] == ["custom-card"]

    assert api.post("/api/lists/cubecobra/preview", json={"url": "missing"}).status_code == 502
    assert api.post("/api/lists/cubecobra/preview", json={"url": "not a cube!"}).status_code == 422

    created = api.post("/api/lists/import", json={
        "name": "My Cube", "kind": "cube", "cubecobra_id": "mycube",
        "items": [{"scryfall_id": i["scryfall_id"], "quantity": i["quantity"], "tags": i["tags"]} for i in body["items"]],
    }).json()
    assert created["cubecobra_id"] == "mycube" and created["synced_at"]


def test_cubecobra_sync_diff_and_apply(api, fake_scryfall, fake_cubecobra):
    _cube_setup(api, fake_scryfall, fake_cubecobra)
    lst = api.post("/api/lists", json={"name": "Mine", "kind": "cube"}).json()
    api.post(f"/api/lists/{lst['id']}/items/bulk", json={"items": [
        {"scryfall_id": ID_A, "quantity": 1}, {"scryfall_id": ID_B, "quantity": 1}]})
    opt = next(i for i in api.get(f"/api/lists/{lst['id']}").json()["items"] if i["card"]["name"] == "Opt")
    api.patch(f"/api/lists/{lst['id']}/items/{opt['id']}", json={"tags": ["Mine"]})

    # Not linked yet.
    assert api.post(f"/api/lists/{lst['id']}/sync", json={}).status_code == 422

    diff = api.post(f"/api/lists/{lst['id']}/sync", json={"cube": "mycube"}).json()
    assert diff["applied"] is False and diff["cube"]["name"] == "My Cube"
    strip = lambda lines: [{k: v for k, v in l.items() if k != "oracle_id"} for l in lines]  # noqa: E731
    assert strip(diff["added"]) == [{"name": "Black Lotus", "quantity": 1, "owned": 0}]
    assert strip(diff["removed"]) == [{"name": "Counterspell", "quantity": 1}]
    assert strip(diff["changed"]) == [{"name": "Opt", "from": 1, "to": 2}]
    assert strip(diff["retagged"]) == [{"name": "Opt", "tags": ["Cantrip", "Blue"]}]
    assert diff["list_size"] == 2
    assert api.get(f"/api/lists/{lst['id']}").json()["cubecobra_id"] is None  # preview saves nothing

    api.post(f"/api/lists/{lst['id']}/sync", json={"cube": "mycube", "apply": True})
    detail = api.get(f"/api/lists/{lst['id']}").json()
    assert detail["cubecobra_id"] == "mycube" and detail["synced_at"]
    items = {i["card"]["name"]: (i["quantity"], i["tags"]) for i in detail["items"]}
    assert items == {"Opt": (2, ["Mine", "Cantrip", "Blue"]), "Black Lotus": (1, [])}

    again = api.post(f"/api/lists/{lst['id']}/sync", json={}).json()
    assert again["added"] == again["removed"] == again["changed"] == again["retagged"] == []

    # A cube with no recognisable cards must never wipe the list.
    fake_cubecobra.add("emptycube", "Empty", [("custom-card", [])])
    assert api.post(f"/api/lists/{lst['id']}/sync", json={"cube": "emptycube", "apply": True}).status_code == 502
    assert len(api.get(f"/api/lists/{lst['id']}").json()["items"]) == 2

    # Re-sending the same cube keeps synced_at; "" unlinks.
    api.patch(f"/api/lists/{lst['id']}", json={"cubecobra_id": "https://cubecobra.com/cube/list/mycube"})
    assert api.get(f"/api/lists/{lst['id']}").json()["synced_at"]
    api.patch(f"/api/lists/{lst['id']}", json={"cubecobra_id": ""})
    assert api.get(f"/api/lists/{lst['id']}").json()["cubecobra_id"] is None


def test_copy_statuses_for_export():
    # No CubeCobra data: owned copies first.
    assert copy_statuses(3, 1, None) == ["Owned", "Not Owned", "Not Owned"]
    # My copies take the real ones (Premium Owned kept), then proxies become Owned; the rest keep their status.
    assert copy_statuses(3, 2, ["Proxied", "Premium Owned", "Ordered"]) == ["Premium Owned", "Owned", "Ordered"]
    assert copy_statuses(2, 0, ["Owned", "Proxied"]) == ["Owned", "Proxied"]
    assert copy_statuses(2, 5, ["Not Owned"]) == ["Owned", "Owned"]


def test_cube_statuses_compare_sync_and_export(api, fake_scryfall, fake_cubecobra):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232"))
    upload(api, [row("Opt", ID_A, qty=1)])
    fake_cubecobra.add("statcube", "Stat Cube", [
        (ID_A, [], "Not Owned"), (ID_A, [], "Proxied"),
        (ID_C, [], "Borrowed"),
    ])
    preview = api.post("/api/lists/cubecobra/preview", json={"url": "statcube"}).json()
    created = api.post("/api/lists/import", json={
        "name": "S", "kind": "cube", "cubecobra_id": "statcube",
        "items": [{"scryfall_id": i["scryfall_id"], "quantity": i["quantity"], "tags": [],
                   "cube_statuses": i["cube_statuses"]} for i in preview["items"]],
    }).json()
    items = {i["card"]["name"]: i for i in api.get(f"/api/lists/{created['id']}").json()["items"]}
    assert (items["Opt"]["cube_statuses"], items["Opt"]["cube_owned"], items["Opt"]["owned"]) == (["Proxied", "Not Owned"], 1, 1)
    assert items["Black Lotus"]["cube_owned"] == 1

    rows = list(csv.DictReader(io.StringIO(api.get(f"/api/lists/{created['id']}/export?format=cubecobra_csv").text)))
    assert sorted((r["name"], r["status"]) for r in rows) == [
        ("Black Lotus", "Borrowed"), ("Opt", "Not Owned"), ("Opt", "Owned")]

    # Statuses changed on CubeCobra show in the diff and are applied.
    fake_cubecobra.add("statcube", "Stat Cube", [(ID_A, [], "Owned"), (ID_A, [], "Owned"), (ID_C, [], "Borrowed")])
    diff = api.post(f"/api/lists/{created['id']}/sync", json={}).json()
    assert [(d["name"], d["from"], d["to"]) for d in diff["restatused"]] == [("Opt", 1, 2)]
    api.post(f"/api/lists/{created['id']}/sync", json={"apply": True})
    items = {i["card"]["name"]: i for i in api.get(f"/api/lists/{created['id']}").json()["items"]}
    assert items["Opt"]["cube_owned"] == 2

    # Lists without CubeCobra data have no cube statuses.
    lst = api.post("/api/lists", json={"name": "Plain"}).json()
    api.post(f"/api/lists/{lst['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 1}]})
    [plain] = api.get(f"/api/lists/{lst['id']}").json()["items"]
    assert (plain["cube_statuses"], plain["cube_owned"]) == (None, None)


def test_legacy_db_is_renamed_and_migrated(tmp_path, monkeypatch):
    import sqlite3

    from app import config, db
    legacy = tmp_path / config.LEGACY_DB_NAME
    conn = sqlite3.connect(legacy)
    conn.executescript(
        "CREATE TABLE lists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',"
        " kind TEXT NOT NULL DEFAULT 'generic', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"
        "INSERT INTO lists VALUES (1, 'Old', '', 'cube', 'x', 'x');"
        "CREATE TABLE list_items (id INTEGER PRIMARY KEY, list_id INTEGER NOT NULL, oracle_id TEXT NOT NULL,"
        " preferred_scryfall_id TEXT NOT NULL, quantity INTEGER NOT NULL, added_at TEXT NOT NULL);"
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "manabox_viewer.sqlite3")
    db.init_db()
    assert not legacy.exists()
    with db.session() as conn:
        assert conn.execute("SELECT name, shared_by FROM lists").fetchone()[:] == ("Old", None)
        assert "their_owned" in {r["name"] for r in conn.execute("PRAGMA table_info(list_items)")}
