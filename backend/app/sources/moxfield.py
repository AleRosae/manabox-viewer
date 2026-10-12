"""Moxfield decks, read from what the user brings: its text export or the bookmarklet's payload.

Moxfield has no public API and its private one rejects server-side requests (Cloudflare), so the
backend never calls Moxfield: the bookmarklet reads the deck in the browser and hands it over.
"""

import re
import sqlite3

from ..cards import fetch_by_identifiers, get_card_data
from ..list_import import ParsedLine, merge_by_oracle, parse_list_text, resolve_lines
from ..scryfall import UUID_RE, ScryfallClient

# "https://moxfield.com/decks/AbC123xyz/primer" -> "AbC123xyz"
URL_RE = re.compile(r"moxfield\.com/decks/(?P<id>[A-Za-z0-9_-]+)", re.IGNORECASE)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")

# Moxfield's boards; the others (attractions, stickers, tokens...) are not deck cards.
BOARDS = {"commanders": "commander", "companions": "companion", "mainboard": "main", "sideboard": "side", "maybeboard": "maybe"}
FORMATS = {"standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern", "commander"}


def parse_deck_ref(text: str) -> str | None:
    """A deck id from a Moxfield URL or a bare id; None when it is neither."""
    text = text.strip()
    m = URL_RE.search(text)
    if m:
        return m.group("id")
    return text if ID_RE.match(text) else None


def deck_url(deck_id: str) -> str:
    return f"https://moxfield.com/decks/{deck_id}"


def map_format(fmt: str | None) -> str | None:
    """Our format for Moxfield's; None when unknown (the deck keeps its own)."""
    if not fmt:
        return None
    return fmt.lower() if fmt.lower() in FORMATS else "none"


def from_text(conn: sqlite3.Connection, client: ScryfallClient, text: str) -> tuple[list[dict], list[str], set[str]]:
    """Moxfield's text export: (entries, unresolved lines, boards it lists).

    The export lists the main deck and the sections it has headers for: boards without a header are
    not in it, and must not be emptied by a sync.
    """
    _, lines, invalid = parse_list_text(text)
    resolved, unresolved = resolve_lines(conn, client, lines)
    boards = {"main"} | {l.board for l in lines if l.board}
    return merge_by_oracle(resolved), invalid + [l.raw for l in unresolved], boards


def from_payload(conn: sqlite3.Connection, client: ScryfallClient, payload: dict) -> tuple[list[dict], list[str], set[str]]:
    """The bookmarklet's deck: {boards: {mainboard: [{scryfall_id, name, quantity, set?, cn?}]}}.

    Every board is listed, even empty ones: the sync mirrors them all.
    """
    cards = [
        (BOARDS[b], c) for b, cs in (payload.get("boards") or {}).items() if b in BOARDS for c in cs or []
    ]
    ids = {c.get("scryfall_id") for _, c in cards if UUID_RE.match(c.get("scryfall_id") or "")}
    known = {i: d for i in ids if (d := get_card_data(conn, i)) is not None}
    missing = sorted(ids - known.keys())
    if missing:
        found, _ = fetch_by_identifiers(conn, client, [{"id": i} for i in missing])
        known.update({c["id"]: c for c in found})

    resolved: list[tuple[ParsedLine, dict]] = []
    by_name: list[ParsedLine] = []
    for board, c in cards:
        line = ParsedLine(
            raw=f'{c.get("quantity", 1)} {c.get("name") or "?"}',
            quantity=max(1, int(c.get("quantity") or 1)),
            name=c.get("name") or "?",
            set_code=(c.get("set") or "").lower() or None,
            collector_number=c.get("cn") or None,
            board=board,
        )
        card = known.get(c.get("scryfall_id") or "")
        if card is not None:
            resolved.append((line, card))
        else:
            by_name.append(line)
    found_by_name, unresolved = resolve_lines(conn, client, by_name) if by_name else ([], [])
    return merge_by_oracle(resolved + found_by_name), [l.raw for l in unresolved], set(BOARDS.values())
