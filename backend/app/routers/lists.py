"""Endpoints shared by cubes and decks: lists, their cards, tokens, text import and exports."""

import json
import re
import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, StringConstraints

from .. import db
from ..cards import ensure_card, now_iso, oracle_id_of
from ..exporters import cubecobra_csv, deck_text, missing_text, plain_text, tokens_text, viewer_list
from ..list_import import merge_by_oracle, normalize_tags, parse_list_text, resolve_lines
from ..lists import store
from ..lists.store import BOARDS, FORMATS, KINDS, MAX_QTY
from ..scryfall import ScryfallError, get_client
from ..sources import cubecobra, moxfield
from ..sources.cubecobra import sort_statuses
from ..tokens import list_tokens, set_override

router = APIRouter(prefix="/api/lists", tags=["lists"])


# Longer tags are cut to MAX_TAG_LEN by normalize_tags; this only bounds the request size.
Tag = Annotated[str, StringConstraints(max_length=200)]
# One line of text: names end up in exported files, where a newline would start a card line.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00-\x1f\x7f]+$")]
Kind = Annotated[str, StringConstraints(pattern=f"^({'|'.join(KINDS)})$")]
Format = Annotated[str, StringConstraints(pattern=f"^({'|'.join(FORMATS)})$")]
Board = Annotated[str, StringConstraints(pattern=f"^({'|'.join(BOARDS)})$")]
REMOTE_SOURCES = {"cubecobra": cubecobra.parse_cube_ref, "moxfield": moxfield.parse_deck_ref}


class ListIn(BaseModel):
    name: Name
    description: str = ""
    kind: Kind = "deck"
    format: Format | None = None


class ListPatch(BaseModel):
    name: Name | None = None
    description: str | None = None
    format: Format | None = None
    unlink: bool = False  # forget the remote list (the cards stay)


class BulkItem(BaseModel):
    scryfall_id: str
    quantity: int = Field(ge=-MAX_QTY, le=MAX_QTY)  # delta: positive adds copies, negative removes them
    # None: copies are added to the main deck and removed from the last board holding the card
    board: Board | None = None


class BulkIn(BaseModel):
    items: list[BulkItem]


class ImportPreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)


class ImportItem(BaseModel):
    scryfall_id: str
    quantity: int = Field(ge=1, le=MAX_QTY)
    board: Board = "main"
    their_owned: int | None = Field(None, ge=0)
    tags: list[Tag] = Field([], max_length=100)
    cube_statuses: list[str] | None = Field(None, max_length=MAX_QTY)


class ImportIn(BaseModel):
    name: Name
    kind: Kind
    format: Format | None = None
    shared_by: str | None = Field(None, max_length=60, pattern=r"^[^\x00-\x1f\x7f]*$")
    remote_source: str | None = Field(None, pattern="^(cubecobra|moxfield)$")
    remote_id: str | None = Field(None, max_length=300)
    items: list[ImportItem] = Field(min_length=1)


class ItemPatch(BaseModel):
    quantity: int | None = Field(None, ge=1, le=MAX_QTY)
    preferred_scryfall_id: str | None = None
    tags: list[Tag] | None = Field(None, max_length=100)
    board: Board | None = None


class TokenPatch(BaseModel):
    quantity: int | None = Field(None, ge=0, le=MAX_QTY)  # None: back to the default
    hidden: bool = False


def _deck_format(kind: str, fmt: str | None) -> str | None:
    """Decks always have a format ('none' checks nothing); cubes never do."""
    return (fmt or "none") if kind == "deck" else None


def _board(kind: str, board: str) -> str:
    """Cubes have a single board."""
    return board if kind == "deck" else "main"


def _card(conn: sqlite3.Connection, scryfall_id: str) -> dict:
    try:
        card = ensure_card(conn, get_client(), scryfall_id)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    if card is None:
        raise HTTPException(404, f"Card {scryfall_id} not found")
    return card


@router.get("")
def list_lists(conn: sqlite3.Connection = Depends(db.get_conn)):
    rows = conn.execute(
        """SELECT l.*,
                  COALESCE(SUM(CASE WHEN i.board != 'maybe' THEN i.quantity END), 0) AS card_count,
                  COUNT(DISTINCT CASE WHEN i.board != 'maybe' THEN i.oracle_id END) AS unique_count
           FROM lists l LEFT JOIN list_items i ON i.list_id = l.id
           GROUP BY l.id ORDER BY l.updated_at DESC"""
    )
    return [dict(r) for r in rows]


@router.get("/usage")
def usage(conn: sqlite3.Connection = Depends(db.get_conn)):
    """{oracle_id: {list_id: quantity}} — used by the 'add to list' stepper."""
    return store.usage_by_oracle(conn)


@router.post("", status_code=201)
def create_list(body: ListIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    ts = now_iso()
    cur = conn.execute(
        "INSERT INTO lists (name, description, kind, format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (body.name, body.description, body.kind, _deck_format(body.kind, body.format), ts, ts),
    )
    return dict(store.get_list(conn, cur.lastrowid))


@router.post("/import/preview")
def import_preview(body: ImportPreviewIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Resolve a pasted/uploaded list and compare it with the collection, without saving anything."""
    meta, lines, invalid = parse_list_text(body.text)
    try:
        resolved, unresolved = resolve_lines(conn, get_client(), lines)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    items = store.preview_items(merge_by_oracle(resolved), store.owned_by_oracle(conn))
    items.sort(key=lambda i: (store.board_rank(i["board"]), i["card"]["name"]))
    kind = meta.get("kind", "")
    has_boards = any(l.board for l in lines)
    return {
        "meta": {
            "name": meta.get("name"),
            # "generic" lists of older share files are decks now
            "kind": "cube" if kind == "cube" else "deck" if kind in ("deck", "generic") or has_boards else None,
            "format": meta.get("format") if meta.get("format") in FORMATS else None,
            "has_ownership": any(i["their_owned"] is not None for i in items),
        },
        "items": items,
        "unresolved": invalid + [l.raw for l in unresolved],
    }


@router.post("/import", status_code=201)
def import_list(body: ImportIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    ts = now_iso()
    shared_by = (body.shared_by or "").strip() or None
    remote_id = None
    if body.remote_source and body.remote_id:
        remote_id = REMOTE_SOURCES[body.remote_source](body.remote_id)
        if remote_id is None:
            raise HTTPException(422, "Not a valid remote list URL or id")
    list_id = conn.execute(
        """INSERT INTO lists (name, description, kind, format, shared_by, remote_source, remote_id, synced_at,
                              created_at, updated_at)
           VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.name, body.kind, _deck_format(body.kind, body.format), shared_by,
         body.remote_source if remote_id else None, remote_id, ts if remote_id else None, ts, ts),
    ).lastrowid
    merged: dict[tuple[str, str], dict] = {}
    for item in body.items:
        card = _card(conn, item.scryfall_id)
        their = min(item.their_owned, item.quantity) if item.their_owned is not None else None
        entry = merged.setdefault(
            (_board(body.kind, item.board), oracle_id_of(card)),
            {"scryfall_id": card["id"], "quantity": 0, "their_owned": None, "tags": [], "statuses": None},
        )
        if item.cube_statuses is not None:
            entry["statuses"] = sort_statuses((entry["statuses"] or []) + item.cube_statuses)
        entry["quantity"] = min(MAX_QTY, entry["quantity"] + item.quantity)
        if their is not None:
            entry["their_owned"] = (entry["their_owned"] or 0) + their
        entry["tags"] = normalize_tags(entry["tags"] + item.tags)
    conn.executemany(
        """INSERT INTO list_items (list_id, board, oracle_id, preferred_scryfall_id, quantity, their_owned, tags,
                                   cube_statuses, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (list_id, board, oid, e["scryfall_id"], e["quantity"], e["their_owned"], json.dumps(e["tags"]),
             json.dumps(e["statuses"]) if e["statuses"] is not None else None, ts)
            for (board, oid), e in merged.items()
        ],
    )
    return dict(store.get_list(conn, list_id))


@router.get("/{list_id}")
def get_list(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    return {**dict(store.get_list(conn, list_id)), "items": store.items(conn, list_id)}


@router.patch("/{list_id}")
def update_list(list_id: int, body: ListPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    lst = store.get_list(conn, list_id)
    changes = body.model_dump(exclude_none=True, exclude={"unlink"})
    if "format" in changes and lst["kind"] != "deck":
        raise HTTPException(422, "Only decks have a format")
    if body.unlink:
        changes.update(remote_source=None, remote_id=None, synced_at=None)
    for column, value in changes.items():
        conn.execute(f"UPDATE lists SET {column} = ? WHERE id = ?", (value, list_id))
    store.touch(conn, list_id)
    return dict(store.get_list(conn, list_id))


@router.delete("/{list_id}", status_code=204)
def delete_list(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    store.get_list(conn, list_id)
    conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))


@router.post("/{list_id}/items/bulk")
def bulk_items(list_id: int, body: BulkIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Add (or with negative quantities remove) copies; returns the deltas actually applied."""
    kind = store.get_list(conn, list_id)["kind"]
    applied = []
    for item in body.items:
        if item.quantity == 0:
            continue
        card = _card(conn, item.scryfall_id)
        oracle_id = oracle_id_of(card)
        board = _board(kind, item.board or _removal_board(conn, list_id, oracle_id, item.quantity))
        existing = conn.execute(
            "SELECT id, quantity FROM list_items WHERE list_id = ? AND board = ? AND oracle_id = ?",
            (list_id, board, oracle_id),
        ).fetchone()
        before = existing["quantity"] if existing else 0
        after = min(MAX_QTY, max(0, before + item.quantity))
        if after == before:
            continue
        if existing and after == 0:
            conn.execute("DELETE FROM list_items WHERE id = ?", (existing["id"],))
        elif existing:
            conn.execute("UPDATE list_items SET quantity = ? WHERE id = ?", (after, existing["id"]))
        else:
            conn.execute(
                """INSERT INTO list_items (list_id, board, oracle_id, preferred_scryfall_id, quantity, added_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (list_id, board, oracle_id, card["id"], after, now_iso()),
            )
        applied.append({
            "oracle_id": oracle_id, "scryfall_id": card["id"], "name": card["name"], "board": board, "delta": after - before,
        })
    if applied:
        store.touch(conn, list_id)
    return {"applied": applied}


def _removal_board(conn: sqlite3.Connection, list_id: int, oracle_id: str, delta: int) -> str:
    if delta > 0:
        return "main"
    boards = [r[0] for r in conn.execute("SELECT board FROM list_items WHERE list_id = ? AND oracle_id = ?", (list_id, oracle_id))]
    # Played copies first: they are the ones counted in the card's usage.
    return max(boards, key=lambda b: (b not in store.UNPLAYED, store.board_rank(b)), default="main")


@router.patch("/{list_id}/items/{item_id}")
def update_item(list_id: int, item_id: int, body: ItemPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    lst = store.get_list(conn, list_id)
    item = conn.execute("SELECT * FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id)).fetchone()
    if not item:
        raise HTTPException(404, "Item not found")
    if body.quantity is not None:
        conn.execute("UPDATE list_items SET quantity = ? WHERE id = ?", (body.quantity, item_id))
    if body.preferred_scryfall_id is not None:
        card = _card(conn, body.preferred_scryfall_id)
        if oracle_id_of(card) != item["oracle_id"]:
            raise HTTPException(422, "The chosen printing is not the same card")
        conn.execute("UPDATE list_items SET preferred_scryfall_id = ? WHERE id = ?", (card["id"], item_id))
    if body.tags is not None:
        conn.execute("UPDATE list_items SET tags = ? WHERE id = ?", (json.dumps(normalize_tags(body.tags)), item_id))
    if body.board is not None and body.board != item["board"]:
        _move(conn, lst, item_id, body.board)
    store.touch(conn, list_id)
    return {"ok": True}


def _move(conn: sqlite3.Connection, lst: sqlite3.Row, item_id: int, board: str) -> None:
    """Move an item to another board, merging it with the copies already there."""
    if lst["kind"] != "deck":
        raise HTTPException(422, "Only decks have boards")
    item = conn.execute("SELECT * FROM list_items WHERE id = ?", (item_id,)).fetchone()
    target = conn.execute(
        "SELECT * FROM list_items WHERE list_id = ? AND board = ? AND oracle_id = ?", (lst["id"], board, item["oracle_id"])
    ).fetchone()
    if target is None:
        conn.execute("UPDATE list_items SET board = ? WHERE id = ?", (board, item_id))
        return
    tags = normalize_tags(json.loads(target["tags"]) + json.loads(item["tags"]))
    conn.execute(
        "UPDATE list_items SET quantity = ?, tags = ? WHERE id = ?",
        (min(MAX_QTY, target["quantity"] + item["quantity"]), json.dumps(tags), target["id"]),
    )
    conn.execute("DELETE FROM list_items WHERE id = ?", (item_id,))


@router.delete("/{list_id}/items/{item_id}", status_code=204)
def delete_item(list_id: int, item_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    conn.execute("DELETE FROM list_items WHERE id = ? AND list_id = ?", (item_id, list_id))
    store.touch(conn, list_id)


@router.get("/{list_id}/tokens")
def get_tokens(list_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    store.get_list(conn, list_id)
    return list_tokens(conn, get_client(), list_id)


@router.patch("/{list_id}/tokens/{oracle_id}")
def update_token(list_id: int, oracle_id: str, body: TokenPatch, conn: sqlite3.Connection = Depends(db.get_conn)):
    store.get_list(conn, list_id)
    set_override(conn, list_id, oracle_id, body.quantity, body.hidden)
    return {"ok": True}


EXPORTS = "cubecobra_csv|txt|deck|viewer|missing|missing_names|tokens|tokens_missing"


@router.get("/{list_id}/export")
def export_list(
    list_id: int,
    format: str = Query("txt", pattern=f"^({EXPORTS})$"),
    conn: sqlite3.Connection = Depends(db.get_conn),
):
    lst = store.get_list(conn, list_id)
    items = store.items(conn, list_id)
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", lst["name"]).strip("_") or "list"
    if format == "cubecobra_csv":
        return PlainTextResponse(
            cubecobra_csv(store.by_card(store.played(items))),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{slug}_cubecobra.csv"'},
        )
    exports = {
        "txt": (lambda: plain_text(store.by_card(store.played(items))), f"{slug}.txt"),
        "deck": (lambda: deck_text(items), f"{slug}_deck.txt"),
        "viewer": (lambda: viewer_list(dict(lst), items, now_iso()[:10]), f"{slug}.mbv.txt"),
        "missing": (lambda: missing_text(store.by_card(store.played(items))), f"{slug}_missing.txt"),
        "missing_names": (lambda: missing_text(store.by_card(store.played(items)), printings=False), f"{slug}_missing.txt"),
        "tokens": (lambda: tokens_text(list_tokens(conn, get_client(), list_id)), f"{slug}_tokens.txt"),
        "tokens_missing": (
            lambda: tokens_text(list_tokens(conn, get_client(), list_id), only_missing=True), f"{slug}_tokens_missing.txt",
        ),
    }
    text, filename = exports[format]
    return PlainTextResponse(text(), headers={"Content-Disposition": f'attachment; filename="{filename}"'})
