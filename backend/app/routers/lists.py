import json
import re
import sqlite3
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from .. import cubecobra, db
from ..cards import ensure_card, get_slims, now_iso, oracle_id_of, slim
from ..cubecobra import CubeCobraError, in_cube_count, parse_cube_ref, resolve_cube, sort_statuses
from ..exporters import cubecobra_csv, missing_text, plain_text, viewer_list
from ..list_import import merge_by_oracle, normalize_tags, parse_list_text, resolve_lines
from ..scryfall import ScryfallError, get_client

router = APIRouter(prefix="/api/lists", tags=["lists"])


# Longer tags are cut to MAX_TAG_LEN by normalize_tags; this only bounds the request size.
Tag = Annotated[str, StringConstraints(max_length=200)]


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    kind: str = Field("generic", pattern="^(cube|generic)$")


class ListPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    kind: str | None = Field(None, pattern="^(cube|generic)$")
    cubecobra_id: str | None = Field(None, max_length=300)  # a cube URL or id; "" unlinks


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
    tags: list[Tag] = Field([], max_length=100)
    cube_statuses: list[str] | None = Field(None, max_length=999)


class ImportIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field("generic", pattern="^(cube|generic)$")
    shared_by: str | None = Field(None, max_length=60)
    cubecobra_id: str | None = Field(None, max_length=300)
    items: list[ImportItem] = Field(min_length=1)


class CubePreviewIn(BaseModel):
    url: str = Field(min_length=1, max_length=300)


class SyncIn(BaseModel):
    cube: str | None = Field(None, max_length=300)  # link to this cube instead of the stored one
    apply: bool = False


class ItemPatch(BaseModel):
    quantity: int | None = Field(None, ge=1, le=999)
    preferred_scryfall_id: str | None = None
    tags: list[Tag] | None = Field(None, max_length=100)


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


def _cube_id(text: str) -> str:
    cube_id = parse_cube_ref(text)
    if cube_id is None:
        raise HTTPException(422, "Not a CubeCobra cube URL or id")
    return cube_id


def _fetch_cube(conn: sqlite3.Connection, cube_id: str) -> tuple[dict, list[dict], list[str]]:
    try:
        cube = cubecobra.get_client().fetch_cube(cube_id)
    except CubeCobraError as exc:
        raise HTTPException(502, str(exc)) from exc
    try:
        entries, unresolved = resolve_cube(conn, get_client(), cube)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    return cube, entries, unresolved


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
        statuses = json.loads(r["cube_statuses"]) if r["cube_statuses"] else None
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
            "tags": json.loads(r["tags"]),
            "cube_statuses": statuses,
            # copies CubeCobra marks as in the cube (owned, proxied...); None when unknown
            "cube_owned": in_cube_count(statuses),
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
            "tags": entry["tags"],
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


@router.post("/cubecobra/preview")
def cubecobra_preview(body: CubePreviewIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Fetch a CubeCobra cube and compare it with the collection, without saving anything."""
    cube, entries, unresolved = _fetch_cube(conn, _cube_id(body.url))
    owned = owned_by_oracle(conn)
    items = []
    for entry in entries:
        own = owned.get(entry["oracle_id"], 0)
        items.append({
            "oracle_id": entry["oracle_id"],
            "scryfall_id": entry["card"]["id"],
            "quantity": entry["quantity"],
            "owned": own,
            "ownership": _ownership(own, entry["quantity"]),
            "their_owned": None,
            "tags": entry["tags"],
            "cube_statuses": entry["statuses"],
            "card": slim(entry["card"]),
        })
    items.sort(key=lambda i: i["card"]["name"])
    return {
        "meta": {"name": cube["name"], "kind": "cube", "has_ownership": False, "cubecobra_id": cube["id"]},
        "items": items,
        "unresolved": unresolved,
    }


@router.post("/import", status_code=201)
def import_list(body: ImportIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    ts = now_iso()
    shared_by = (body.shared_by or "").strip() or None
    cube_id = _cube_id(body.cubecobra_id) if body.cubecobra_id else None
    list_id = conn.execute(
        """INSERT INTO lists (name, description, kind, shared_by, cubecobra_id, synced_at, created_at, updated_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?)""",
        (body.name.strip(), body.kind, shared_by, cube_id, ts if cube_id else None, ts, ts),
    ).lastrowid
    client = get_client()
    merged: dict[str, dict] = {}
    for item in body.items:
        try:
            card = ensure_card(conn, client, item.scryfall_id)
        except ScryfallError as exc:
            raise HTTPException(502, str(exc)) from exc
        if card is None:
            raise HTTPException(404, f"Card {item.scryfall_id} not found")
        their = min(item.their_owned, item.quantity) if item.their_owned is not None else None
        entry = merged.setdefault(
            oracle_id_of(card), {"scryfall_id": card["id"], "quantity": 0, "their_owned": None, "tags": [], "statuses": None}
        )
        if item.cube_statuses is not None:
            entry["statuses"] = sort_statuses((entry["statuses"] or []) + item.cube_statuses)
        entry["quantity"] += item.quantity
        if their is not None:
            entry["their_owned"] = (entry["their_owned"] or 0) + their
        entry["tags"] = normalize_tags(entry["tags"] + item.tags)
    conn.executemany(
        """INSERT INTO list_items (list_id, oracle_id, preferred_scryfall_id, quantity, their_owned, tags, cube_statuses, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (list_id, oid, e["scryfall_id"], e["quantity"], e["their_owned"], json.dumps(e["tags"]),
             json.dumps(e["statuses"]) if e["statuses"] is not None else None, ts)
            for oid, e in merged.items()
        ],
    )
    return dict(_get_list(conn, list_id))


@router.get("/{list_id}")
def get_list(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    return {**dict(_get_list(conn, list_id)), "items": _items(conn, list_id)}


@router.patch("/{list_id}")
def update_list(list_id: int, body: ListPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    lst = _get_list(conn, list_id)
    changes = body.model_dump(exclude_none=True)
    if "cubecobra_id" in changes:
        changes["cubecobra_id"] = _cube_id(changes["cubecobra_id"]) if changes["cubecobra_id"].strip() else None
        if changes["cubecobra_id"] == lst["cubecobra_id"]:
            del changes["cubecobra_id"]
        else:
            changes["synced_at"] = None
    for field, value in changes.items():
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
    if body.tags is not None:
        conn.execute("UPDATE list_items SET tags = ? WHERE id = ?", (json.dumps(normalize_tags(body.tags)), item_id))
    _touch(conn, list_id)
    return {"ok": True}


@router.delete("/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: int, item_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    conn.execute("DELETE FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id))
    _touch(conn, list_id)


@router.post("/{list_id}/sync")
def sync_list(list_id: int, body: SyncIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Diff the list against its CubeCobra cube; with apply, make the cards match it.

    CubeCobra decides which cards, how many copies and their statuses; tags are merged (local
    ones are kept) and the printing chosen locally is preserved.
    """
    lst = _get_list(conn, list_id)
    cube_id = _cube_id(body.cube) if body.cube else lst["cubecobra_id"]
    if not cube_id:
        raise HTTPException(422, "The list is not linked to a CubeCobra cube")
    cube, entries, unresolved = _fetch_cube(conn, cube_id)
    if not entries:
        # Never let an empty (or unreadable) cube wipe the list.
        raise HTTPException(502, f"No recognisable cards in the cube “{cube['name']}”")

    current = {r["oracle_id"]: dict(r) for r in conn.execute("SELECT * FROM list_items WHERE list_id = ?", (list_id,))}
    incoming = {e["oracle_id"]: e for e in entries}
    names = {sid: c["name"] for sid, c in get_slims(conn, (r["preferred_scryfall_id"] for r in current.values())).items()}
    owned = owned_by_oracle(conn)

    added = [e for oid, e in incoming.items() if oid not in current]
    removed = [r for oid, r in current.items() if oid not in incoming]
    changed, retagged, restatused = [], [], []
    for oid, e in incoming.items():
        if oid not in current:
            continue
        row = current[oid]
        if row["quantity"] != e["quantity"]:
            changed.append((row, e))
        local = json.loads(row["tags"])
        merged = normalize_tags(local + e["tags"])
        if len(merged) > len(local):
            retagged.append((row, merged, merged[len(local):]))
        before = json.loads(row["cube_statuses"]) if row["cube_statuses"] else None
        if before != e["statuses"]:
            restatused.append((row, before, e["statuses"]))

    if body.apply:
        ts = now_iso()
        conn.executemany(
            # ON CONFLICT: a concurrent sync may have added the card in the meantime.
            """INSERT INTO list_items (list_id, oracle_id, preferred_scryfall_id, quantity, tags, cube_statuses, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (list_id, oracle_id) DO UPDATE SET quantity = excluded.quantity""",
            [
                (list_id, e["oracle_id"], e["card"]["id"], e["quantity"], json.dumps(e["tags"]), json.dumps(e["statuses"]), ts)
                for e in added
            ],
        )
        conn.executemany("DELETE FROM list_items WHERE id = ?", [(r["id"],) for r in removed])
        conn.executemany("UPDATE list_items SET quantity = ? WHERE id = ?", [(e["quantity"], r["id"]) for r, e in changed])
        conn.executemany("UPDATE list_items SET tags = ? WHERE id = ?", [(json.dumps(t), r["id"]) for r, t, _ in retagged])
        conn.executemany(
            "UPDATE list_items SET cube_statuses = ? WHERE id = ?", [(json.dumps(new), r["id"]) for r, _, new in restatused]
        )
        conn.execute(
            "UPDATE lists SET cubecobra_id = ?, synced_at = ?, updated_at = ? WHERE id = ?",
            (cube["id"], ts, ts, list_id),
        )

    def name_of(row: dict) -> str:
        return names.get(row["preferred_scryfall_id"], "?")

    # oracle_id identifies each line: names can repeat (Un-cards, missing card data).

    return {
        "cube": {"id": cube["id"], "name": cube["name"], "url": cubecobra.cube_url(cube["id"])},
        "applied": body.apply,
        "added": sorted(
            ({"oracle_id": e["oracle_id"], "name": e["card"]["name"], "quantity": e["quantity"],
              "owned": owned.get(e["oracle_id"], 0)} for e in added),
            key=lambda x: x["name"],
        ),
        "removed": sorted(
            ({"oracle_id": r["oracle_id"], "name": name_of(r), "quantity": r["quantity"]} for r in removed),
            key=lambda x: x["name"],
        ),
        "changed": sorted(
            ({"oracle_id": r["oracle_id"], "name": name_of(r), "from": r["quantity"], "to": e["quantity"]} for r, e in changed),
            key=lambda x: x["name"],
        ),
        "retagged": sorted(
            ({"oracle_id": r["oracle_id"], "name": name_of(r), "tags": new} for r, _, new in retagged), key=lambda x: x["name"]
        ),
        # CubeCobra's owned/proxied/... marks changed (or are new for this list): "from" is None when unknown
        "restatused": sorted(
            ({"oracle_id": r["oracle_id"], "name": name_of(r), "from": in_cube_count(old), "to": in_cube_count(new),
              "quantity": len(new)} for r, old, new in restatused),
            key=lambda x: x["name"],
        ),
        "unresolved": unresolved,
        "list_size": len(current),
    }


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
