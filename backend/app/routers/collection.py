import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..cards import ensure_card, get_slims, slim
from ..scryfall import ScryfallError, get_client

router = APIRouter(prefix="/api", tags=["collection"])

ROW_FIELDS = (
    "id", "binder_name", "name", "set_code", "collector_number", "finish", "rarity", "quantity",
    "scryfall_id", "purchase_price", "currency", "condition", "language", "signed", "altered",
    "misprint", "proxy", "added_at",
)


@router.get("/collection")
def collection(conn: sqlite3.Connection = Depends(db.get_conn)):
    current = db.latest_ready_import(conn)
    if current is None:
        return {"import": None, "rows": [], "cards": {}}
    rows = conn.execute(
        f"SELECT {', '.join(ROW_FIELDS)} FROM collection_rows WHERE import_id = ? ORDER BY name",
        (current["id"],),
    ).fetchall()
    rows = [dict(r) for r in rows]
    cards = get_slims(conn, (r["scryfall_id"] for r in rows if r["scryfall_id"]))
    return {"import": dict(current), "rows": rows, "cards": cards}


@router.get("/cards/{scryfall_id}")
def card(scryfall_id: str, conn: sqlite3.Connection = Depends(db.get_conn)):
    try:
        data = ensure_card(conn, get_client(), scryfall_id)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    if data is None:
        raise HTTPException(404, "Carta non trovata")
    return slim(data)
