"""Cubes and decks: what they have in common (items, ownership against the collection, usage across lists)."""

import json
import sqlite3
from collections import defaultdict

from fastapi import HTTPException

from .. import db
from ..cards import get_slims, now_iso, slim
from ..list_import import MAX_QTY
from ..sources.cubecobra import in_cube_count

KINDS = ("cube", "deck")
# Deck formats with their rules in the frontend (lib/legality.ts); 'none' checks nothing.
FORMATS = ("none", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern", "commander")
# Display order, which is also the order owned copies are assigned in: a card owned once and played
# in the main deck and in the sideboard counts as owned for the main deck.
BOARDS = ("commander", "companion", "main", "side", "maybe")
# Considered cards, not played: they don't take copies from other lists.
UNPLAYED = {"maybe"}


def owned_by_oracle(conn: sqlite3.Connection) -> dict[str, int]:
    current = db.latest_ready_import(conn)
    if current is None:
        return {}
    rows = conn.execute(
        """SELECT c.oracle_id, SUM(r.quantity) FROM collection_rows r
           JOIN cards c ON c.scryfall_id = r.scryfall_id
           WHERE r.import_id = ? GROUP BY c.oracle_id""",
        (current["id"],),
    )
    return {r[0]: r[1] for r in rows}


def usage_by_oracle(conn: sqlite3.Connection) -> dict[str, dict[int, int]]:
    """{oracle_id: {list_id: copies}} over every board but the maybeboard."""
    usage: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for r in conn.execute("SELECT oracle_id, list_id, quantity, board FROM list_items"):
        if r[3] not in UNPLAYED:
            usage[r[0]][r[1]] += r[2]
    return usage


def get_list(conn: sqlite3.Connection, list_id: int, kind: str | None = None) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    if not row or (kind and row["kind"] != kind):
        raise HTTPException(404, "List not found")
    return row


def touch(conn: sqlite3.Connection, list_id: int) -> None:
    conn.execute("UPDATE lists SET updated_at = ? WHERE id = ?", (now_iso(), list_id))


def ownership(owned: int, quantity: int) -> str:
    if owned <= 0:
        return "not_owned"
    return "owned" if owned >= quantity else "partial"


def board_rank(board: str) -> int:
    return BOARDS.index(board) if board in BOARDS else len(BOARDS)


def items(conn: sqlite3.Connection, list_id: int) -> list[dict]:
    """The list's items with their card and how they compare with the collection.

    `owned` is what the collection has left for the item once the boards before it in the same
    list took theirs; `used_elsewhere` counts the copies played in other lists.
    """
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM list_items WHERE list_id = ? ORDER BY added_at, id", (list_id,)
    )]
    slims = get_slims(conn, (r["preferred_scryfall_id"] for r in rows))
    owned = owned_by_oracle(conn)
    usage = usage_by_oracle(conn)
    left = dict(owned)
    for r in sorted(rows, key=lambda r: board_rank(r["board"])):
        r["owned"] = left.get(r["oracle_id"], 0)
        left[r["oracle_id"]] = max(0, r["owned"] - r["quantity"])
    out = []
    for r in rows:
        card = slims.get(r["preferred_scryfall_id"])
        if card is None:
            continue
        statuses = json.loads(r["cube_statuses"]) if r["cube_statuses"] else None
        elsewhere = sum(q for lid, q in usage.get(r["oracle_id"], {}).items() if lid != list_id)
        out.append({
            "id": r["id"],
            "board": r["board"],
            "oracle_id": r["oracle_id"],
            "scryfall_id": r["preferred_scryfall_id"],
            "quantity": r["quantity"],
            "added_at": r["added_at"],
            "owned": r["owned"],
            "used_elsewhere": elsewhere,
            "ownership": ownership(r["owned"], r["quantity"]),
            "their_owned": r["their_owned"],
            "tags": json.loads(r["tags"]),
            "cube_statuses": statuses,
            # copies CubeCobra marks as in the cube (owned, proxied...); None when unknown
            "cube_owned": in_cube_count(statuses),
            "card": card,
        })
    return out


def played(list_items: list[dict]) -> list[dict]:
    """The items that make the deck or cube: the maybeboard is left out of exports and shopping lists."""
    return [i for i in list_items if i["board"] not in UNPLAYED]


def by_card(list_items: list[dict]) -> list[dict]:
    """Items merged across boards (one per card): for exports that know nothing about boards."""
    merged: dict[str, dict] = {}
    for i in sorted(list_items, key=lambda i: board_rank(i["board"])):
        if i["oracle_id"] not in merged:
            # The first board's `owned` is what the collection has for the card.
            merged[i["oracle_id"]] = {**i, "tags": list(i["tags"])}
        else:
            m = merged[i["oracle_id"]]
            m["quantity"] += i["quantity"]
            m["tags"] += [t for t in i["tags"] if t not in m["tags"]]
    return list(merged.values())


def preview_items(entries: list[dict], owned: dict[str, int]) -> list[dict]:
    """Resolved entries of a list to import, compared with the collection (nothing is saved)."""
    left = dict(owned)
    out = []
    for e in sorted(entries, key=lambda e: board_rank(e.get("board", "main"))):
        own = left.get(e["oracle_id"], 0)
        left[e["oracle_id"]] = max(0, own - e["quantity"])
        out.append({
            "oracle_id": e["oracle_id"],
            "board": e.get("board", "main"),
            "scryfall_id": e["card"]["id"],
            "quantity": e["quantity"],
            "owned": own,
            "ownership": ownership(own, e["quantity"]),
            "their_owned": e.get("their_owned"),
            "tags": e.get("tags") or [],
            "cube_statuses": e.get("statuses"),
            "card": slim(e["card"]),
        })
    return out
