"""Decks (boards, Moxfield sync), tokens and the lists migration."""

import sqlite3

from app import config, db
from app.cards import related_kind
from app.list_import import parse_list_text
from app.sources.moxfield import map_format, parse_deck_ref
from conftest import fake_card
from test_backend import ID_A, ID_B, ID_C, row, upload

ID_D = "00000000-0000-0000-0000-00000000000d"
TOKEN = "00000000-0000-0000-0000-0000000000f1"
EMBLEM = "00000000-0000-0000-0000-0000000000f2"
MONARCH = "00000000-0000-0000-0000-0000000000f3"
OTHER = "00000000-0000-0000-0000-0000000000f4"


def _deck(api, name="Deck", fmt="commander"):
    return api.post("/api/lists", json={"name": name, "kind": "deck", "format": fmt}).json()


def _items(api, list_id):
    return {(i["board"], i["card"]["name"]): i for i in api.get(f"/api/lists/{list_id}").json()["items"]}


# --- migration ------------------------------------------------------------------------------

def test_lists_of_the_previous_schema_become_cubes_and_decks(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "manabox_viewer.sqlite3")
    conn = sqlite3.connect(config.DB_PATH)
    conn.executescript(
        "CREATE TABLE lists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',"
        " kind TEXT NOT NULL DEFAULT 'generic', shared_by TEXT, cubecobra_id TEXT, synced_at TEXT,"
        " created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"
        "INSERT INTO lists VALUES (1, 'Cube', '', 'cube', NULL, 'mycube', 's', 'x', 'x');"
        "INSERT INTO lists VALUES (2, 'Wishlist', '', 'generic', 'Marco', NULL, NULL, 'x', 'x');"
        "INSERT INTO lists VALUES (3, 'Linked', '', 'generic', NULL, 'cc', NULL, 'x', 'x');"
        "INSERT INTO lists VALUES (9, 'Deleted', '', 'generic', NULL, NULL, NULL, 'x', 'x');"
        "DELETE FROM lists WHERE id = 9;"
        "CREATE TABLE list_items (id INTEGER PRIMARY KEY AUTOINCREMENT, list_id INTEGER NOT NULL REFERENCES lists(id)"
        " ON DELETE CASCADE, oracle_id TEXT NOT NULL, preferred_scryfall_id TEXT NOT NULL, quantity INTEGER NOT NULL,"
        " their_owned INTEGER, tags TEXT NOT NULL DEFAULT '[]', cube_statuses TEXT, added_at TEXT NOT NULL,"
        " UNIQUE (list_id, oracle_id));"
        "INSERT INTO list_items VALUES (1, 1, 'o1', 's1', 2, NULL, '[\"Blue\"]', NULL, 'x');"
        "INSERT INTO list_items VALUES (2, 2, 'o1', 's1', 1, 1, '[]', NULL, 'x');"
    )
    conn.commit()
    conn.close()
    db.init_db()
    db.init_db()  # a second start finds the schema up to date
    with db.session() as conn:
        lists = [tuple(r) for r in conn.execute("SELECT id, kind, format, shared_by, remote_source, remote_id FROM lists")]
        assert lists == [(1, "cube", None, None, "cubecobra", "mycube"), (2, "deck", "none", "Marco", None, None),
                         (3, "cube", None, None, "cubecobra", "cc")]
        # Ids of deleted lists are not handed out again.
        assert [tuple(r) for r in conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'lists'")] == [(9,)]
        items = [tuple(r) for r in conn.execute("SELECT list_id, board, quantity, tags FROM list_items ORDER BY id")]
        assert items == [(1, "main", 2, '["Blue"]'), (2, "main", 1, "[]")]
        # Foreign keys still cascade after the tables were rebuilt.
        conn.execute("DELETE FROM lists WHERE id = 1")
        assert conn.execute("SELECT COUNT(*) FROM list_items").fetchone()[0] == 1


# --- boards ---------------------------------------------------------------------------------

def test_boards_ownership_usage_and_moves(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_B, "Counterspell", number="2"))
    upload(api, [row("Opt", ID_A, qty=1)])
    deck = _deck(api, fmt="modern")
    assert deck["format"] == "modern"
    url = f"/api/lists/{deck['id']}/items/bulk"
    api.post(url, json={"items": [
        {"scryfall_id": ID_A, "quantity": 1, "board": "main"},
        {"scryfall_id": ID_A, "quantity": 1, "board": "side"},
        {"scryfall_id": ID_B, "quantity": 2, "board": "maybe"},
    ]})
    items = _items(api, deck["id"])
    # The one copy owned goes to the main deck first.
    assert (items[("main", "Opt")]["ownership"], items[("side", "Opt")]["ownership"]) == ("owned", "not_owned")
    # The maybeboard takes no copies from other lists and is not counted as cards of the deck.
    usage = api.get("/api/lists/usage").json()
    assert usage[items[("main", "Opt")]["oracle_id"]] == {str(deck["id"]): 2}
    assert items[("maybe", "Counterspell")]["oracle_id"] not in usage
    summary = next(l for l in api.get("/api/lists").json() if l["id"] == deck["id"])
    assert (summary["card_count"], summary["unique_count"]) == (2, 1)

    # Moving onto a board that has the card merges the copies.
    api.patch(f"/api/lists/{deck['id']}/items/{items[('side', 'Opt')]['id']}", json={"board": "main"})
    items = _items(api, deck["id"])
    assert items[("main", "Opt")]["quantity"] == 2 and ("side", "Opt") not in items
    api.patch(f"/api/lists/{deck['id']}/items/{items[('maybe', 'Counterspell')]['id']}", json={"board": "commander"})
    assert ("commander", "Counterspell") in _items(api, deck["id"])
    # Removing without a board takes from the last board holding the card.
    api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": 1, "board": "maybe"}]})
    api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": 1, "board": "side"}]})
    api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": -1}]})
    assert sorted(k for k in _items(api, deck["id"]) if k[1] == "Opt") == [("main", "Opt"), ("maybe", "Opt")]
    # ...and played copies before the maybeboard's.
    api.post(url, json={"items": [{"scryfall_id": ID_A, "quantity": -2}]})
    assert [k for k in _items(api, deck["id"]) if k[1] == "Opt"] == [("maybe", "Opt")]

    # Cubes have a single board.
    cube = api.post("/api/lists", json={"name": "C", "kind": "cube"}).json()
    assert cube["format"] is None
    api.post(f"/api/lists/{cube['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 1, "board": "side"}]})
    assert list(_items(api, cube["id"])) == [("main", "Opt")]
    item = _items(api, cube["id"])[("main", "Opt")]
    assert api.patch(f"/api/lists/{cube['id']}/items/{item['id']}", json={"board": "side"}).status_code == 422
    assert api.patch(f"/api/lists/{cube['id']}", json={"format": "modern"}).status_code == 422


def test_deck_exports(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_B, "Counterspell", number="2"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232"))
    upload(api, [row("Opt", ID_A, qty=1)])
    deck = _deck(api)
    api.post(f"/api/lists/{deck['id']}/items/bulk", json={"items": [
        {"scryfall_id": ID_C, "quantity": 1, "board": "commander"},
        {"scryfall_id": ID_A, "quantity": 2, "board": "main"},
        {"scryfall_id": ID_A, "quantity": 1, "board": "side"},
        {"scryfall_id": ID_B, "quantity": 1, "board": "maybe"},
    ]})
    export = lambda f: api.get(f"/api/lists/{deck['id']}/export?format={f}").text  # noqa: E731
    assert export("deck") == (
        "Commander\n1 Black Lotus (TST) 232\n\nDeck\n2 Opt (TST) 1\n\nSideboard\n1 Opt (TST) 1\n\n"
        "Maybeboard\n1 Counterspell (TST) 2\n"
    )
    # Shopping lists: boards merged, the maybeboard left out; by name for shops with their own set codes.
    assert export("missing") == "1 Black Lotus (TST) 232\n2 Opt (TST) 1\n"
    assert export("missing_names") == "1 Black Lotus\n2 Opt\n"
    assert export("txt") == "1 Black Lotus (TST) 232\n3 Opt (TST) 1\n"

    viewer = export("viewer")
    assert "# kind: deck\n# format: commander\n" in viewer
    back = api.post("/api/lists/import/preview", json={"text": viewer}).json()
    assert back["meta"]["kind"] == "deck" and back["meta"]["format"] == "commander"
    assert [(i["board"], i["card"]["name"], i["quantity"]) for i in back["items"]] == [
        ("commander", "Black Lotus", 1), ("main", "Opt", 2), ("side", "Opt", 1), ("maybe", "Counterspell", 1)]
    created = api.post("/api/lists/import", json={
        "name": "Copy", "kind": "deck", "format": "commander",
        "items": [{"scryfall_id": i["scryfall_id"], "quantity": i["quantity"], "board": i["board"]} for i in back["items"]],
    }).json()
    assert sorted(_items(api, created["id"])) == sorted(_items(api, deck["id"]))


# --- Moxfield ---------------------------------------------------------------------------------

def test_moxfield_text_parsing():
    _, lines, invalid = parse_list_text(
        "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring (CMM) 400 #Ramp #!Staple\n"
        "1 Opt *CMDR*\nSIDEBOARD:\n2 Duress\n// Maybeboard\n1 Thoughtseize\n"
    )
    assert invalid == []
    assert [(l.board, l.name, l.set_code) for l in lines] == [
        ("commander", "Atraxa, Praetors' Voice", None), ("main", "Sol Ring", "cmm"), ("commander", "Opt", None),
        ("side", "Duress", None), ("maybe", "Thoughtseize", None),
    ]
    assert parse_deck_ref("https://moxfield.com/decks/AbC-123_x/primer") == "AbC-123_x"
    assert parse_deck_ref("https://example.com") is None
    assert (map_format("Commander"), map_format("historicBrawl"), map_format(None)) == ("commander", "none", None)


def _mox_setup(api, fake_scryfall):
    fake_scryfall.add(fake_card(ID_A, "Opt"))
    fake_scryfall.add(fake_card(ID_B, "Counterspell", number="2"))
    fake_scryfall.add(fake_card(ID_C, "Black Lotus", number="232"))
    fake_scryfall.add(fake_card(ID_D, "Duress", number="4"))
    upload(api, [row("Opt", ID_A, qty=1)])


def _payload(boards: dict) -> dict:
    return {"id": "deck123", "name": "Lotus Deck", "format": "vintage", "boards": {
        b: [{"scryfall_id": sid, "name": name, "quantity": q} for sid, name, q in cards] for b, cards in boards.items()
    }}


def test_moxfield_import_from_payload_and_sync(api, fake_scryfall):
    _mox_setup(api, fake_scryfall)
    payload = _payload({
        "mainboard": [(ID_A, "Opt", 4), (ID_C, "Black Lotus", 1)],
        "sideboard": [(ID_D, "Duress", 2)],
        "maybeboard": [],
        "attractions": [(ID_B, "Counterspell", 1)],  # not a deck board
    })
    preview = api.post("/api/decks/moxfield/preview", json={"payload": payload}).json()
    assert preview["meta"] == {"name": "Lotus Deck", "kind": "deck", "format": "vintage", "has_ownership": False,
                               "remote": {"source": "moxfield", "id": "deck123"}}
    assert [(i["board"], i["card"]["name"], i["quantity"], i["owned"]) for i in preview["items"]] == [
        ("main", "Black Lotus", 1, 0), ("main", "Opt", 4, 1), ("side", "Duress", 2, 0)]

    deck = api.post("/api/lists/import", json={
        "name": "Lotus Deck", "kind": "deck", "format": "vintage", "remote_source": "moxfield", "remote_id": "deck123",
        "items": [{"scryfall_id": i["scryfall_id"], "quantity": i["quantity"], "board": i["board"]} for i in preview["items"]],
    }).json()
    assert (deck["remote_source"], deck["remote_id"], deck["format"]) == ("moxfield", "deck123", "vintage")

    # On Moxfield: Duress moves to the main deck, Opt goes to 3, Lotus leaves, Counterspell comes in.
    changed = _payload({
        "mainboard": [(ID_A, "Opt", 3), (ID_D, "Duress", 2)],
        "sideboard": [(ID_B, "Counterspell", 1)],
    })
    changed["format"] = "legacy"
    diff = api.post(f"/api/decks/{deck['id']}/sync", json={"payload": changed}).json()
    pick = lambda key, *fields: [tuple(l[f] for f in fields) for l in diff[key]]  # noqa: E731
    assert pick("added", "board", "name", "quantity") == [("side", "Counterspell", 1)]
    assert pick("removed", "board", "name") == [("main", "Black Lotus")]
    assert pick("changed", "board", "name", "from", "to") == [("main", "Opt", 4, 3)]
    assert pick("moved", "from_board", "board", "name") == [("side", "main", "Duress")]
    assert diff["format"] == {"from": "vintage", "to": "legacy"}
    assert diff["remote"]["url"] == "https://moxfield.com/decks/deck123"

    api.post(f"/api/decks/{deck['id']}/sync", json={"payload": changed, "apply": True})
    assert {k: i["quantity"] for k, i in _items(api, deck["id"]).items()} == {
        ("main", "Opt"): 3, ("main", "Duress"): 2, ("side", "Counterspell"): 1}
    assert api.get(f"/api/lists/{deck['id']}").json()["format"] == "legacy"
    again = api.post(f"/api/decks/{deck['id']}/sync", json={"payload": changed}).json()
    assert again["added"] == again["removed"] == again["changed"] == again["moved"] == [] and again["format"] is None

    # A deck linked to Moxfield doesn't silently switch to another deck; ids are checked.
    other = {**changed, "id": "another1"}
    assert api.post(f"/api/decks/{deck['id']}/sync", json={"payload": other}).status_code == 422
    assert api.post("/api/decks/moxfield/preview", json={"payload": {**changed, "id": "../x?y"}}).status_code == 422

    # Cubes are synced with CubeCobra, not Moxfield.
    cube = api.post("/api/lists", json={"name": "C", "kind": "cube"}).json()
    assert api.post(f"/api/decks/{cube['id']}/sync", json={"payload": changed}).status_code == 404


def test_moxfield_text_sync_keeps_boards_the_export_lacks(api, fake_scryfall):
    _mox_setup(api, fake_scryfall)
    deck = _deck(api)
    api.post(f"/api/lists/{deck['id']}/items/bulk", json={"items": [
        {"scryfall_id": ID_C, "quantity": 1, "board": "commander"},
        {"scryfall_id": ID_A, "quantity": 1, "board": "main"},
        {"scryfall_id": ID_D, "quantity": 1, "board": "maybe"},
    ]})
    # Not linked and no URL: nothing to link the deck to.
    assert api.post(f"/api/decks/{deck['id']}/sync", json={"text": "1 Opt"}).status_code == 422
    # The export has the commander among the main cards and no maybeboard: both stay as they are here.
    text = "1 Black Lotus\n1 Opt\n1 Counterspell\n"
    diff = api.post(f"/api/decks/{deck['id']}/sync", json={"text": text, "deck": "moxfield.com/decks/abcd1234"}).json()
    assert [l["name"] for l in diff["added"]] == ["Counterspell"]
    assert diff["removed"] == [] and diff["kept_boards"] == ["commander", "maybe"]
    api.post(f"/api/decks/{deck['id']}/sync", json={"text": text, "deck": "moxfield.com/decks/abcd1234", "apply": True})
    assert sorted(_items(api, deck["id"])) == [
        ("commander", "Black Lotus"), ("main", "Counterspell"), ("main", "Opt"), ("maybe", "Duress")]
    assert api.get(f"/api/lists/{deck['id']}").json()["remote_id"] == "abcd1234"

    # A card also on a board the export lacks keeps its copies on the boards the export lists.
    api.post(f"/api/lists/{deck['id']}/items/bulk", json={"items": [{"scryfall_id": ID_A, "quantity": 1, "board": "maybe"}]})
    diff = api.post(f"/api/decks/{deck['id']}/sync", json={"text": "5000 Opt\n1 Counterspell\n1 Black Lotus"}).json()
    # (quantities are capped)
    assert [(l["name"], l["from"], l["to"]) for l in diff["changed"]] == [("Opt", 1, 999)]
    assert diff["removed"] == diff["added"] == []

    # An export with no recognisable card never empties the deck.
    assert api.post(f"/api/decks/{deck['id']}/sync", json={"text": "1 Nothing Like This", "apply": True}).status_code == 502
    assert len(_items(api, deck["id"])) == 5


# --- tokens -----------------------------------------------------------------------------------

def test_related_parts_are_classified():
    kind = lambda component, type_line, name="X": related_kind({"component": component, "type_line": type_line, "name": name})  # noqa: E731
    assert kind("token", "Token Creature — Soldier") == "token"
    assert kind("combo_piece", "Emblem — Elspeth") == "emblem"
    assert kind("combo_piece", "Emblem // Card") == "emblem"  # The Ring
    assert kind("combo_piece", "Dungeon") == "marker"
    assert kind("combo_piece", "Card", "The Monarch") == "marker"
    assert kind("combo_piece", "Card", "Ixalan Checklist") is None
    assert kind("combo_piece", "Creature — Human Warrior") is None
    assert kind("meld_part", "Legendary Creature — Angel Horror") is None


def test_list_tokens_overrides_and_export(api, fake_scryfall):
    part = lambda pid, component, type_line, name: {"id": pid, "component": component, "type_line": type_line, "name": name}  # noqa: E731
    fake_scryfall.add(fake_card(TOKEN, "Soldier", set_code="tkn", layout="token", type_line="Token Creature — Soldier"))
    fake_scryfall.add(fake_card(EMBLEM, "Elspeth Emblem", set_code="tkn", number="2", layout="emblem", type_line="Emblem — Elspeth"))
    fake_scryfall.add(fake_card(MONARCH, "The Monarch", set_code="tkn", number="3", layout="token", type_line="Card"))
    fake_scryfall.add(fake_card(ID_A, "Elspeth", all_parts=[
        part(ID_A, "combo_piece", "Legendary Planeswalker — Elspeth", "Elspeth"),
        part(TOKEN, "token", "Token Creature — Soldier", "Soldier"),
        part(EMBLEM, "combo_piece", "Emblem — Elspeth", "Elspeth Emblem"),
    ]))
    fake_scryfall.add(fake_card(ID_B, "Marchesa", number="2", all_parts=[
        part(TOKEN, "token", "Token Creature — Soldier", "Soldier"),
        part(MONARCH, "combo_piece", "Card", "The Monarch"),
        part(OTHER, "combo_piece", "Instant", "Some Combo Card"),
    ]))
    fake_scryfall.add(fake_card(ID_C, "Maybe Maker", number="3", all_parts=[part(OTHER, "token", "Token Creature — Zombie", "Zombie")]))
    upload(api, [row("Soldier", TOKEN, set_code="TKN", number="1", qty=2)])
    deck = _deck(api)
    api.post(f"/api/lists/{deck['id']}/items/bulk", json={"items": [
        {"scryfall_id": ID_A, "quantity": 1}, {"scryfall_id": ID_B, "quantity": 1},
        {"scryfall_id": ID_C, "quantity": 1, "board": "maybe"},  # the maybeboard makes no tokens
    ]})
    tokens = api.get(f"/api/lists/{deck['id']}/tokens").json()
    assert [(t["kind"], t["card"]["name"], t["sources"], t["quantity"], t["ownership"]) for t in tokens] == [
        ("token", "Soldier", ["Elspeth", "Marchesa"], 1, "owned"),
        ("emblem", "Elspeth Emblem", ["Elspeth"], 1, "not_owned"),
        ("marker", "The Monarch", ["Marchesa"], 1, "not_owned"),
    ]
    soldier, _, monarch = (t["oracle_id"] for t in tokens)
    api.patch(f"/api/lists/{deck['id']}/tokens/{soldier}", json={"quantity": 3})
    api.patch(f"/api/lists/{deck['id']}/tokens/{monarch}", json={"hidden": True})
    tokens = {t["card"]["name"]: t for t in api.get(f"/api/lists/{deck['id']}/tokens").json()}
    assert (tokens["Soldier"]["quantity"], tokens["Soldier"]["custom"], tokens["Soldier"]["ownership"]) == (3, True, "partial")
    assert tokens["The Monarch"]["hidden"] is True

    export = lambda f: api.get(f"/api/lists/{deck['id']}/export?format={f}").text  # noqa: E731
    assert export("tokens") == "1 Elspeth Emblem (TKN) 2\n3 Soldier (TKN) 1\n"
    assert export("tokens_missing") == "1 Elspeth Emblem (TKN) 2\n1 Soldier (TKN) 1\n"

    # Back to the default.
    api.patch(f"/api/lists/{deck['id']}/tokens/{soldier}", json={})
    assert next(t for t in api.get(f"/api/lists/{deck['id']}/tokens").json() if t["oracle_id"] == soldier)["quantity"] == 1
