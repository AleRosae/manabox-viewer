import re
import sqlite3
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .. import db
from ..cards import ensure_card, get_slims, now_iso, oracle_id_of, slim
from ..exporters import cubecobra_csv, missing_text, plain_text, viewer_list
from ..list_import import merge_by_oracle, parse_list_text, resolve_lines
from ..scryfall import ScryfallError, get_client

router = APIRouter(prefix="/api/lists", tags=["lists"])


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    kind: str = Field("generic", pattern="^(cube|generic)$")


class ListPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    kind: str | None = Field(None, pattern="^(cube|generic)$")


class BulkItem(BaseModel):
    scryfall_id: str
    quantity: int  # delta: positive adds copies, negative removes them


class BulkIn(BaseModel):
    items: list[BulkItem]


class ImportPreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)


class ImportItem(BaseModel):
    scryfall_id: str
    quantity: int = Field(ge=1, le=999)
    their_owned: int | None = Field(None, ge=0)


class ImportIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field("generic", pattern="^(cube|generic)$")
    shared_by: str | None = Field(None, max_length=60)
    items: list[ImportItem] = Field(min_length=1)


class ItemPatch(BaseModel):
    quantity: int | None = Field(None, ge=1, le=999)
    preferred_scryfall_id: str | None = None


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
    usage: dict[str, dict[int, int]] = defaultdict(dict)
    for r in conn.execute("SELECT oracle_id, list_id, quantity FROM list_items"):
        usage[r[0]][r[1]] = r[2]
    return usage


def _get_list(conn: sqlite3.Connection, list_id: int):
    row = conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone()
    if not row:
        raise HTTPException(404, "List not found")
    return row


def _touch(conn: sqlite3.Connection, list_id: int) -> None:
    conn.execute("UPDATE lists SET updated_at = ? WHERE id = ?", (now_iso(), list_id))


def _ownership(owned: int, quantity: int) -> str:
    if owned <= 0:
        return "not_owned"
    return "owned" if owned >= quantity else "partial"


def _items(conn: sqlite3.Connection, list_id: int) -> list[dict]:
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM list_items WHERE list_id = ? ORDER BY added_at, id", (list_id,)
    )]
    slims = get_slims(conn, (r["preferred_scryfall_id"] for r in rows))
    owned = owned_by_oracle(conn)
    usage = usage_by_oracle(conn)
    out = []
    for r in rows:
        card = slims.get(r["preferred_scryfall_id"])
        if card is None:
            continue
        own = owned.get(r["oracle_id"], 0)
        elsewhere = sum(q for lid, q in usage.get(r["oracle_id"], {}).items() if lid != list_id)
        out.append({
            "id": r["id"],
            "oracle_id": r["oracle_id"],
            "scryfall_id": r["preferred_scryfall_id"],
            "quantity": r["quantity"],
            "added_at": r["added_at"],
            "owned": own,
            "used_elsewhere": elsewhere,
            "ownership": _ownership(own, r["quantity"]),
            "their_owned": r["their_owned"],
            "card": card,
        })
    return out


@router.get("")
def list_lists(conn: sqlite3.Connection = Depends(db.get_conn)):
    rows = conn.execute(
        """SELECT l.*, COALESCE(SUM(i.quantity), 0) AS card_count, COUNT(i.id) AS unique_count
           FROM lists l LEFT JOIN list_items i ON i.list_id = l.id
           GROUP BY l.id ORDER BY l.updated_at DESC"""
    )
    return [dict(r) for r in rows]


@router.get("/usage")
def usage(conn: sqlite3.Connection = Depends(db.get_conn)):
    """{oracle_id: {list_id: quantity}} — used by the 'add to list' stepper."""
    return usage_by_oracle(conn)


@router.post("", status_code=201)
def create_list(body: ListIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    ts = now_iso()
    cur = conn.execute(
        "INSERT INTO lists (name, description, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (body.name.strip(), body.description, body.kind, ts, ts),
    )
    return dict(_get_list(conn, cur.lastrowid))


@router.post("/import/preview")
def import_preview(body: ImportPreviewIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Resolve a pasted/uploaded list and compare it with the collection, without saving anything."""
    meta, lines, invalid = parse_list_text(body.text)
    try:
        resolved, unresolved = resolve_lines(conn, get_client(), lines)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    owned = owned_by_oracle(conn)
    items = []
    for entry in merge_by_oracle(resolved):
        own = owned.get(entry["oracle_id"], 0)
        items.append({
            "oracle_id": entry["oracle_id"],
            "scryfall_id": entry["card"]["id"],
            "quantity": entry["quantity"],
            "owned": own,
            "ownership": _ownership(own, entry["quantity"]),
            "their_owned": entry["their_owned"],
            "card": slim(entry["card"]),
        })
    items.sort(key=lambda i: i["card"]["name"])
    kind = meta.get("kind", "")
    return {
        "meta": {
            "name": meta.get("name"),
            "kind": kind if kind in ("cube", "generic") else None,
            "has_ownership": any(i["their_owned"] is not None for i in items),
        },
        "items": items,
        "unresolved": invalid + [l.raw for l in unresolved],
    }


@router.post("/import", status_code=201)
def import_list(body: ImportIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    ts = now_iso()
    shared_by = (body.shared_by or "").strip() or None
    list_id = conn.execute(
        "INSERT INTO lists (name, description, kind, shared_by, created_at, updated_at) VALUES (?, '', ?, ?, ?, ?)",
        (body.name.strip(), body.kind, shared_by, ts, ts),
    ).lastrowid
    client = get_client()
    for item in body.items:
        try:
            card = ensure_card(conn, client, item.scryfall_id)
        except ScryfallError as exc:
            raise HTTPException(502, str(exc)) from exc
        if card is None:
            raise HTTPException(404, f"Card {item.scryfall_id} not found")
        their = min(item.their_owned, item.quantity) if item.their_owned is not None else None
        conn.execute(
            """INSERT INTO list_items (list_id, oracle_id, preferred_scryfall_id, quantity, their_owned, added_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (list_id, oracle_id) DO UPDATE SET
                 quantity = quantity + excluded.quantity,
                 their_owned = CASE WHEN their_owned IS NULL AND excluded.their_owned IS NULL THEN NULL
                                    ELSE COALESCE(their_owned, 0) + COALESCE(excluded.their_owned, 0) END""",
            (list_id, oracle_id_of(card), card["id"], item.quantity, their, ts),
        )
    return dict(_get_list(conn, list_id))


@router.get("/{list_id}")
def get_list(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    return {**dict(_get_list(conn, list_id)), "items": _items(conn, list_id)}


@router.patch("/{list_id}")
def update_list(list_id: int, body: ListPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    _get_list(conn, list_id)
    for field, value in body.model_dump(exclude_none=True).items():
        conn.execute(f"UPDATE lists SET {field} = ? WHERE id = ?", (value, list_id))
    _touch(conn, list_id)
    return dict(_get_list(conn, list_id))


@router.delete("/{list_id}", status_code=204)
def delete_list(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    _get_list(conn, list_id)
    conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))


@router.post("/{list_id}/items/bulk")
def bulk_items(list_id: int, body: BulkIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Add (or with negative quantities remove) copies; returns the deltas actually applied."""
    _get_list(conn, list_id)
    client = get_client()
    applied = []
    for item in body.items:
        if item.quantity == 0:
            continue
        try:
            card = ensure_card(conn, client, item.scryfall_id)
        except ScryfallError as exc:
            raise HTTPException(502, str(exc)) from exc
        if card is None:
            raise HTTPException(404, f"Card {item.scryfall_id} not found")
        oracle_id = oracle_id_of(card)
        existing = conn.execute(
            "SELECT id, quantity FROM list_items WHERE list_id = ? AND oracle_id = ?", (list_id, oracle_id)
        ).fetchone()
        before = existing["quantity"] if existing else 0
        after = max(0, before + item.quantity)
        if after == before:
            continue
        if existing and after == 0:
            conn.execute("DELETE FROM list_items WHERE id = ?", (existing["id"],))
        elif existing:
            conn.execute("UPDATE list_items SET quantity = ? WHERE id = ?", (after, existing["id"]))
        else:
            conn.execute(
                "INSERT INTO list_items (list_id, oracle_id, preferred_scryfall_id, quantity, added_at) VALUES (?, ?, ?, ?, ?)",
                (list_id, oracle_id, card["id"], after, now_iso()),
            )
        applied.append({"oracle_id": oracle_id, "scryfall_id": card["id"], "name": card["name"], "delta": after - before})
    if applied:
        _touch(conn, list_id)
    return {"applied": applied}


@router.patch("/{list_id}/items/{item_id}")
def update_item(list_id: int, item_id: int, body: ItemPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    item = conn.execute(
        "SELECT * FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id)
    ).fetchone()
    if not item:
        raise HTTPException(404, "Item not found")
    if body.quantity is not None:
        conn.execute("UPDATE list_items SET quantity = ? WHERE id = ?", (body.quantity, item_id))
    if body.preferred_scryfall_id is not None:
        card = ensure_card(conn, get_client(), body.preferred_scryfall_id)
        if card is None or oracle_id_of(card) != item["oracle_id"]:
            raise HTTPException(422, "The chosen printing is not the same card")
        conn.execute("UPDATE list_items SET preferred_scryfall_id = ? WHERE id = ?", (card["id"], item_id))
    _touch(conn, list_id)
    return {"ok": True}


@router.delete("/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: int, item_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    conn.execute("DELETE FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id))
    _touch(conn, list_id)


@router.get("/{list_id}/export")
def export_list(
    list_id: int,
    format: str = Query("cubecobra_csv", pattern="^(cubecobra_csv|txt|viewer|missing)$"),
    conn: sqlite3.Connection = Depends(db.get_conn),
):
    lst = _get_list(conn, list_id)
    items = _items(conn, list_id)
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", lst["name"]).strip("_") or "list"
    if format in ("txt", "viewer", "missing"):
        text, filename = {
            "txt": (lambda: plain_text(items), f"{slug}.txt"),
            "viewer": (lambda: viewer_list(dict(lst), items, now_iso()[:10]), f"{slug}.mbv.txt"),
            "missing": (lambda: missing_text(items), f"{slug}_missing.txt"),
        }[format]
        return PlainTextResponse(text(), headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    return PlainTextResponse(
        cubecobra_csv(items),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{slug}_cubecobra.csv"'},
    )
