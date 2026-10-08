"""Import of card lists from text: plain '2 Name (SET) 123' lines or the ManaBox Viewer format."""

import re
import sqlite3
from dataclasses import dataclass, field

from .cards import fetch_by_identifiers, oracle_id_of, upsert_cards
from .scryfall import ScryfallClient

MAX_LINES = 2000
# Fuzzy lookups are one request each: only try a bounded number of them.
MAX_FUZZY = 40
# Section headers written by deck builders (Arena, Moxfield, ...).
SECTION_RE = re.compile(r"^(deck|main ?deck|mainboard|sideboard|maybeboard|commander|companion|about)\s*:?$", re.IGNORECASE)

# "2x Lightning Bolt (2X2) 117 *F* | owned 1 | tags: Burn; Aggro" — everything but the name is optional.
LINE_RE = re.compile(
    r"""^(?:(?P<qty>\d+)x?\s+)?
        (?P<name>.+?)
        (?:\s+\((?P<set>[A-Za-z0-9]{2,6})\)(?:\s+(?P<cn>[^\s|*]+))?)?
        (?:\s+\*[A-Za-z]+\*)*
        (?:\s*\|\s*owned\s+(?P<owned>\d+))?
        (?:\s*\|\s*tags:(?P<tags>[^|]*))?
        \s*$""",
    re.VERBOSE | re.IGNORECASE,
)


@dataclass
class ParsedLine:
    raw: str
    quantity: int
    name: str
    set_code: str | None = None
    collector_number: str | None = None
    owned: int | None = None
    tags: list[str] = field(default_factory=list)


MAX_TAGS = 20
MAX_TAG_LEN = 40


def normalize_tags(tags: list[str] | str) -> list[str]:
    """Trimmed, de-duplicated (case-insensitively) labels, at most MAX_TAGS (extra ones are dropped).

    ';', ',' and '|' become spaces: they are separators in the exports.
    """
    if isinstance(tags, str):
        tags = [tags]
    out: dict[str, str] = {}
    for tag in tags:
        tag = re.sub(r"[\s;,|]+", " ", str(tag)).strip()
        # A leading = + @ would make the exported CSV cell a spreadsheet formula.
        tag = tag.lstrip("=+@ ")[:MAX_TAG_LEN].strip()
        if tag and tag.lower() not in out:
            out[tag.lower()] = tag
    return list(out.values())[:MAX_TAGS]


def parse_list_text(text: str) -> tuple[dict, list[ParsedLine], list[str]]:
    """Return (meta, parsed lines, unparseable lines). meta comes from '# key: value' headers."""
    meta: dict[str, str] = {}
    lines: list[ParsedLine] = []
    invalid: list[str] = []
    for raw in text.lstrip("﻿").splitlines()[:MAX_LINES]:
        line = raw.strip()
        if not line:
            continue
        if SECTION_RE.match(line):
            continue
        if line.startswith(("#", "//")):
            header = re.match(r"^#\s*([a-z_]+)\s*:\s*(.*)$", line, re.IGNORECASE)
            if header:
                meta[header.group(1).lower()] = header.group(2).strip()
            continue
        m = LINE_RE.match(line)
        if not m or not m.group("name").strip():
            invalid.append(line)
            continue
        lines.append(ParsedLine(
            raw=line,
            quantity=max(1, int(m.group("qty") or 1)),
            name=m.group("name").strip(),
            set_code=(m.group("set") or "").lower() or None,
            collector_number=m.group("cn"),
            owned=int(m.group("owned")) if m.group("owned") is not None else None,
            tags=normalize_tags((m.group("tags") or "").split(";")),
        ))
    return meta, lines, invalid


def _norm(name: str) -> str:
    return name.strip().lower()


def _names(card: dict) -> set[str]:
    full = card["name"]
    return {_norm(full), _norm(full.split(" // ")[0])}


def resolve_lines(
    conn: sqlite3.Connection, client: ScryfallClient, lines: list[ParsedLine]
) -> tuple[list[tuple[ParsedLine, dict]], list[ParsedLine]]:
    """Find the Scryfall card of each line: by set + number, then by exact name, then fuzzy name."""
    resolved: dict[int, dict] = {}

    by_print = [(i, l) for i, l in enumerate(lines) if l.set_code and l.collector_number]
    if by_print:
        found, _ = fetch_by_identifiers(
            conn, client, [{"set": l.set_code, "collector_number": l.collector_number} for _, l in by_print]
        )
        index = {(c["set"].lower(), c["collector_number"]): c for c in found}
        for i, l in by_print:
            card = index.get((l.set_code, l.collector_number))
            # A wrong set/number pair must not silently become a different card.
            if card and _norm(l.name) in _names(card):
                resolved[i] = card

    pending = [(i, l) for i, l in enumerate(lines) if i not in resolved]
    if pending:
        names = list({_norm(l.name): l.name for _, l in pending}.values())
        found, _ = fetch_by_identifiers(conn, client, [{"name": n} for n in names])
        index = {n: c for c in found for n in _names(c)}
        for i, l in pending:
            if _norm(l.name) in index:
                resolved[i] = index[_norm(l.name)]

    for i, l in [(i, l) for i, l in enumerate(lines) if i not in resolved][:MAX_FUZZY]:
        card = client.named(fuzzy=l.name)
        if card:
            upsert_cards(conn, [card])
            resolved[i] = card

    ok = [(l, resolved[i]) for i, l in enumerate(lines) if i in resolved]
    missing = [l for i, l in enumerate(lines) if i not in resolved]
    return ok, missing


def merge_by_oracle(resolved: list[tuple[ParsedLine, dict]]) -> list[dict]:
    """One entry per card: quantities and owned copies add up, tags merge, the first printing wins."""
    merged: dict[str, dict] = {}
    for line, card in resolved:
        oid = oracle_id_of(card)
        entry = merged.setdefault(oid, {"oracle_id": oid, "card": card, "quantity": 0, "their_owned": None, "tags": []})
        entry["quantity"] += line.quantity
        entry["tags"] = normalize_tags(entry["tags"] + line.tags)
        if line.owned is not None:
            entry["their_owned"] = (entry["their_owned"] or 0) + min(line.owned, line.quantity)
    return list(merged.values())
