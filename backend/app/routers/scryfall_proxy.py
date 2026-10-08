import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..cards import slim, upsert_cards
from ..scryfall import ScryfallError, get_client

router = APIRouter(prefix="/api/scryfall", tags=["scryfall"])

_autocomplete_cache: dict[str, list[str]] = {}


@router.get("/autocomplete")
def autocomplete(q: str = Query(..., min_length=2, max_length=100)):
    key = q.strip().lower()
    if key not in _autocomplete_cache:
        if len(_autocomplete_cache) > 2000:
            _autocomplete_cache.clear()
        _autocomplete_cache[key] = get_client().autocomplete(key)
    return _autocomplete_cache[key]


@router.get("/named")
def named(name: str = Query(..., min_length=1), conn: sqlite3.Connection = Depends(db.get_conn)):
    """Resolve an exact card name (e.g. from autocomplete) to a card, caching it locally."""
    try:
        card = get_client().named(name)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    if card is None:
        raise HTTPException(404, "Card not found")
    upsert_cards(conn, [card])
    return slim(card)


@router.get("/prints/{oracle_id}")
def prints(oracle_id: str, conn: sqlite3.Connection = Depends(db.get_conn)):
    """All printings of a card, to choose the preferred one in a list."""
    cards = get_client().prints(oracle_id)
    upsert_cards(conn, cards)
    return [slim(c) for c in cards]
