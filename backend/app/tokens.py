"""Tokens, emblems and markers (The Monarch, dungeons...) a list needs, from the cards in it.

They are computed every time from the cards' Scryfall data; the list_tokens table only keeps what
the user changed (how many copies, hidden ones).
"""

import sqlite3

from .cards import fetch_by_identifiers, get_slims
from .lists.store import items as list_items, owned_by_oracle, ownership, played
from .scryfall import ScryfallClient

KIND_ORDER = ("token", "emblem", "marker")
DEFAULT_QUANTITY = 1


def list_tokens(conn: sqlite3.Connection, client: ScryfallClient, list_id: int) -> list[dict]:
    """[{oracle_id, scryfall_id, kind, card, sources, quantity, custom, hidden, owned, ownership}], by kind then name.

    Token cards not cached yet are fetched from Scryfall; when it doesn't answer they are left out
    this time.
    """
    parts: list[tuple[dict, str]] = []  # (part of a card's `produces`, name of the card)
    for item in played(list_items(conn, list_id)):
        parts += [(p, item["card"]["name"]) for p in item["card"].get("produces") or []]

    ids = {p["id"] for p, _ in parts}
    slims = get_slims(conn, ids)
    missing = sorted(ids - slims.keys())
    if missing:
        fetch_by_identifiers(conn, client, [{"id": i} for i in missing], failed=[])
        slims.update(get_slims(conn, missing))

    tokens: dict[str, dict] = {}
    for part, source in parts:
        card = slims.get(part["id"])
        if card is None:
            continue
        token = tokens.setdefault(
            card["oracle_id"], {"oracle_id": card["oracle_id"], "scryfall_id": card["id"], "kind": part["kind"], "card": card, "sources": []}
        )
        if source not in token["sources"]:
            token["sources"].append(source)

    overrides = {
        r["oracle_id"]: r for r in conn.execute("SELECT * FROM list_tokens WHERE list_id = ?", (list_id,))
    }
    owned = owned_by_oracle(conn)
    out = []
    for oid, token in tokens.items():
        override = overrides.get(oid)
        quantity = override["quantity"] if override and override["quantity"] is not None else DEFAULT_QUANTITY
        own = owned.get(oid, 0)
        out.append({
            **token,
            "sources": sorted(token["sources"]),
            "quantity": quantity,
            "custom": bool(override and override["quantity"] is not None),
            "hidden": bool(override and override["hidden"]),
            "owned": own,
            "ownership": ownership(own, quantity),
        })
    return sorted(out, key=lambda t: (KIND_ORDER.index(t["kind"]), t["card"]["name"]))


def set_override(conn: sqlite3.Connection, list_id: int, oracle_id: str, quantity: int | None, hidden: bool) -> None:
    if quantity is None and not hidden:
        conn.execute("DELETE FROM list_tokens WHERE list_id = ? AND oracle_id = ?", (list_id, oracle_id))
        return
    conn.execute(
        """INSERT INTO list_tokens (list_id, oracle_id, quantity, hidden) VALUES (?, ?, ?, ?)
           ON CONFLICT (list_id, oracle_id) DO UPDATE SET quantity = excluded.quantity, hidden = excluded.hidden""",
        (list_id, oracle_id, quantity, int(hidden)),
    )
