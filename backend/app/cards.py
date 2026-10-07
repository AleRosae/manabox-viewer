"""Scryfall card cache: storage, slim projection and batch enrichment."""

import json
import sqlite3
from datetime import datetime, timezone
from typing import Callable, Iterable

from .scryfall import BATCH_SIZE, ScryfallClient


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def oracle_id_of(card: dict) -> str:
    # Reversible cards keep oracle_id only on faces; fall back to the card id.
    return (
        card.get("oracle_id")
        or next((f.get("oracle_id") for f in card.get("card_faces", []) if f.get("oracle_id")), None)
        or card["id"]
    )


def _face(face: dict) -> dict:
    return {
        "name": face.get("name"),
        "mana_cost": face.get("mana_cost") or "",
        "type_line": face.get("type_line") or "",
        "oracle_text": face.get("oracle_text") or "",
        "colors": face.get("colors"),
        "power": face.get("power"),
        "toughness": face.get("toughness"),
        "loyalty": face.get("loyalty"),
        "has_image": "image_uris" in face,
    }


def slim(card: dict) -> dict:
    """The subset of Scryfall data the frontend needs for search, stats and display."""
    faces = card.get("card_faces") or []
    colors = card.get("colors")
    if colors is None:
        colors = sorted({c for f in faces for c in (f.get("colors") or [])})
    prices = card.get("prices") or {}

    def joined(key: str) -> str:
        if card.get(key) is not None:
            return card[key]
        return " // ".join(f[key] for f in faces if f.get(key))

    return {
        "id": card["id"],
        "oracle_id": oracle_id_of(card),
        "name": card["name"],
        "lang": card.get("lang"),
        "layout": card.get("layout"),
        "mana_cost": joined("mana_cost"),
        "cmc": card.get("cmc", 0) or 0,
        "type_line": joined("type_line"),
        "oracle_text": joined("oracle_text"),
        "colors": colors,
        "color_identity": card.get("color_identity", []),
        "keywords": card.get("keywords", []),
        "power": card.get("power") or next((f.get("power") for f in faces if f.get("power")), None),
        "toughness": card.get("toughness") or next((f.get("toughness") for f in faces if f.get("toughness")), None),
        "loyalty": card.get("loyalty") or next((f.get("loyalty") for f in faces if f.get("loyalty")), None),
        "rarity": card.get("rarity"),
        "set": card.get("set"),
        "set_name": card.get("set_name"),
        "collector_number": card.get("collector_number"),
        "released_at": card.get("released_at"),
        "artist": card.get("artist"),
        "legal": sorted(k for k, v in (card.get("legalities") or {}).items() if v == "legal"),
        "games": card.get("games", []),
        "faces": [_face(f) for f in faces],
        "image_faces": 2 if len(faces) > 1 and all("image_uris" in f for f in faces) else 1,
        "prices": {k: prices.get(k) for k in ("eur", "eur_foil", "eur_etched", "usd", "usd_foil", "usd_etched")},
        "scryfall_uri": card.get("scryfall_uri"),
    }


def upsert_cards(conn: sqlite3.Connection, cards: Iterable[dict]) -> None:
    ts = now_iso()
    conn.executemany(
        """INSERT INTO cards (scryfall_id, oracle_id, name, data_json, slim_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(scryfall_id) DO UPDATE SET oracle_id = excluded.oracle_id, name = excluded.name,
             data_json = excluded.data_json, slim_json = excluded.slim_json, fetched_at = excluded.fetched_at""",
        [
            (c["id"], oracle_id_of(c), c["name"], json.dumps(c), json.dumps(slim(c)), ts)
            for c in cards
        ],
    )


def cached_ids(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT scryfall_id FROM cards")}


def get_card_data(conn: sqlite3.Connection, scryfall_id: str) -> dict | None:
    row = conn.execute("SELECT data_json FROM cards WHERE scryfall_id = ?", (scryfall_id,)).fetchone()
    return json.loads(row[0]) if row else None


def get_slims(conn: sqlite3.Connection, ids: Iterable[str]) -> dict[str, dict]:
    ids = list(set(ids))
    out: dict[str, dict] = {}
    for i in range(0, len(ids), 500):
        chunk = ids[i : i + 500]
        q = f"SELECT scryfall_id, slim_json FROM cards WHERE scryfall_id IN ({','.join('?' * len(chunk))})"
        out.update({r[0]: json.loads(r[1]) for r in conn.execute(q, chunk)})
    return out


def ensure_card(conn: sqlite3.Connection, client: ScryfallClient, scryfall_id: str) -> dict | None:
    data = get_card_data(conn, scryfall_id)
    if data is None:
        data = client.card(scryfall_id)
        if data is None:
            return None
        upsert_cards(conn, [data])
    return data


def fetch_by_identifiers(
    conn: sqlite3.Connection,
    client: ScryfallClient,
    identifiers: list[dict],
    progress: Callable[[int, int], None] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Fetch cards in batches of 75, store them and return (found, not_found)."""
    found_all: list[dict] = []
    missing_all: list[dict] = []
    total = len(identifiers)
    for i in range(0, total, BATCH_SIZE):
        batch = identifiers[i : i + BATCH_SIZE]
        found, missing = client.collection(batch)
        upsert_cards(conn, found)
        conn.commit()
        found_all.extend(found)
        missing_all.extend(missing)
        if progress:
            progress(min(i + BATCH_SIZE, total), total)
    return found_all, missing_all


# Bump when slim() changes so cached projections are rebuilt at startup.
SLIM_VERSION = 1


def rebuild_slims_if_needed(conn: sqlite3.Connection) -> None:
    if conn.execute("PRAGMA user_version").fetchone()[0] == SLIM_VERSION:
        return
    rows = conn.execute("SELECT scryfall_id, data_json FROM cards").fetchall()
    conn.executemany(
        "UPDATE cards SET slim_json = ? WHERE scryfall_id = ?",
        [(json.dumps(slim(json.loads(r[1]))), r[0]) for r in rows],
    )
    conn.execute(f"PRAGMA user_version = {SLIM_VERSION}")
