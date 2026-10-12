"""Decks linked to Moxfield: import preview and sync, from a pasted export or the bookmarklet's payload."""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from .. import db
from ..lists import store
from ..lists.store import MAX_QTY
from ..lists.sync import Snapshot, sync
from ..scryfall import ScryfallError, get_client
from ..sources import moxfield

router = APIRouter(prefix="/api/decks", tags=["decks"])

Short = Annotated[str, StringConstraints(max_length=200)]


class MoxCard(BaseModel):
    scryfall_id: Short | None = None
    name: Short
    quantity: int = Field(1, ge=1, le=MAX_QTY)
    set: Short | None = None
    cn: Short | None = None


class MoxDeck(BaseModel):
    """What the bookmarklet reads from Moxfield's deck page."""
    id: Short
    name: Short = "Moxfield deck"
    format: Short | None = None
    boards: dict[Short, list[MoxCard]] = Field(max_length=20)


class MoxfieldIn(BaseModel):
    """Either the deck text exported from Moxfield, or the bookmarklet's payload."""
    deck: str | None = Field(None, max_length=300)  # deck URL or id: links the list to it
    text: str | None = Field(None, max_length=500_000)
    payload: MoxDeck | None = None
    apply: bool = False


def _snapshot(conn: sqlite3.Connection, body: MoxfieldIn, fallback_id: str | None = None) -> Snapshot:
    deck_id = None
    if body.payload:
        deck_id = moxfield.parse_deck_ref(body.payload.id)
        if deck_id is None:
            raise HTTPException(422, "Not a Moxfield deck id")
    if not deck_id and body.deck:
        deck_id = moxfield.parse_deck_ref(body.deck)
        if deck_id is None:
            raise HTTPException(422, "Not a Moxfield deck URL")
    deck_id = deck_id or fallback_id
    try:
        if body.payload:
            entries, unresolved, boards = moxfield.from_payload(conn, get_client(), body.payload.model_dump())
            name, fmt = body.payload.name, moxfield.map_format(body.payload.format)
        elif body.text and body.text.strip():
            entries, unresolved, boards = moxfield.from_text(conn, get_client(), body.text)
            name, fmt = "Moxfield deck", None
        else:
            raise HTTPException(422, "Paste the deck exported from Moxfield")
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    return Snapshot("moxfield", deck_id or "", name, moxfield.deck_url(deck_id) if deck_id else "", entries, unresolved, boards, fmt)


@router.post("/moxfield/preview")
def moxfield_preview(body: MoxfieldIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Resolve a Moxfield deck and compare it with the collection, without saving anything."""
    snap = _snapshot(conn, body)
    items = store.preview_items(snap.entries, store.owned_by_oracle(conn))
    items.sort(key=lambda i: (store.board_rank(i["board"]), i["card"]["name"]))
    return {
        "meta": {"name": snap.name if body.payload else None, "kind": "deck", "format": snap.format, "has_ownership": False,
                 "remote": {"source": "moxfield", "id": snap.id} if snap.id else None},
        "items": items,
        "unresolved": snap.unresolved,
    }


@router.post("/{list_id}/sync")
def sync_deck(list_id: int, body: MoxfieldIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Diff the deck against its Moxfield version; with apply, make the cards match it.

    Moxfield decides the cards, their boards and copies; boards a pasted export doesn't list are
    left alone, and the printing chosen locally is kept.
    """
    lst = store.get_list(conn, list_id, kind="deck")
    linked = lst["remote_id"] if lst["remote_source"] == "moxfield" else None
    snap = _snapshot(conn, body, linked)
    if not snap.id:
        raise HTTPException(422, "Give the Moxfield deck URL to link the deck to")
    if linked and snap.id != linked:
        raise HTTPException(422, f"This deck is linked to another Moxfield deck ({linked}): unlink it first")
    return sync(conn, lst, snap, body.apply)
