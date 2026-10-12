"""List exporters: CubeCobra CSV, deck text (Moxfield, Arena...), shopping lists and the app's own share format."""

import csv
import io
import re

from .lists.store import BOARDS
from .sources.cubecobra import REAL, STATUSES

# Header of CubeCobra's own CSV export, which its "Replace with CSV file upload" accepts back.
CUBECOBRA_HEADER = [
    "name", "CMC", "Type", "Color", "Set", "Collector Number", "Rarity", "Color Category",
    "status", "Finish", "board", "maybeboard", "image URL", "image Back URL", "tags", "Notes", "MTGO ID",
]


def copy_statuses(quantity: int, owned: int, cube_statuses: list[str] | None) -> list[str]:
    """CubeCobra status of each copy: copies in the collection become Owned (Premium Owned stays),
    the others keep their CubeCobra status (Proxied, Ordered...) or are Not Owned."""
    known = sorted((s for s in cube_statuses or [] if s in STATUSES), key=STATUSES.index)
    known += [None] * (quantity - len(known))
    return [
        (s if s in REAL else "Owned") if n < owned else (s or "Not Owned")
        for n, s in enumerate(known[:quantity])
    ]


def cubecobra_csv(items: list[dict]) -> str:
    """items: [{card: slim, quantity, owned, tags, cube_statuses}] — one row per copy, tags joined by ';'."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CUBECOBRA_HEADER)
    for item in sorted(items, key=lambda i: i["card"]["name"]):
        card = item["card"]
        row = [
            card["name"],
            f"{card['cmc']:g}",
            card["type_line"],
            "".join(card["colors"] or []),
            card["set"],
            card["collector_number"],
            card["rarity"],
            "",
            "",  # status: set per copy below
            "Non-foil",
            "mainboard",
            "false",
            "", "",
            ";".join(item.get("tags") or []),
            "", "",
        ]
        for status in copy_statuses(item["quantity"], item["owned"], item.get("cube_statuses")):
            row[8] = status
            writer.writerow(row)
    return buf.getvalue()


def _line(i: dict) -> str:
    return f'{i["quantity"]} {i["card"]["name"]} ({i["card"]["set"].upper()}) {i["card"]["collector_number"]}'


def plain_text(items: list[dict]) -> str:
    """'1 Name (SET) 123' lines, accepted by CubeCobra, Moxfield and most deck tools."""
    return "\n".join(_line(i) for i in sorted(items, key=lambda i: i["card"]["name"])) + "\n"


# Section headers of the Arena format, which Moxfield and most deck builders import.
SECTION = {"commander": "Commander", "companion": "Companion", "main": "Deck", "side": "Sideboard", "maybe": "Maybeboard"}


def _sections(items: list[dict], line) -> list[str]:
    """Lines grouped by board under Arena headers; a list with only a main deck gets no header."""
    boards = [b for b in BOARDS if any(i["board"] == b for i in items)]
    if boards in ([], ["main"]):
        return [line(i) for i in sorted(items, key=lambda i: i["card"]["name"])]
    out: list[str] = []
    for b in boards:
        if out:
            out.append("")
        out.append(SECTION[b])
        out += [line(i) for i in sorted((i for i in items if i["board"] == b), key=lambda i: i["card"]["name"])]
    return out


def deck_text(items: list[dict]) -> str:
    """The deck with its boards, to paste into Moxfield (or Arena, MTGO...)."""
    return "\n".join(_sections(items, _line)) + "\n"


VIEWER_MAGIC = "# ManaBox Viewer list v2"


def viewer_list(lst: dict, items: list[dict], exported_on: str) -> str:
    """The app's own sharing format: the deck text plus the exporter's owned copies and tags.

    Everything after '|' is ignored by tools that only read '1 Name (SET) 123'.
    """
    # Names saved before they were validated may hold a newline, which would start a card line.
    name = re.sub(r"[\x00-\x1f\x7f]+", " ", lst["name"])
    lines = [VIEWER_MAGIC, f"# name: {name}", f"# kind: {lst['kind']}"]
    if lst.get("format"):
        lines.append(f"# format: {lst['format']}")
    lines.append(f"# exported: {exported_on}")

    def line(i: dict) -> str:
        text = f'{_line(i)} | owned {min(i["owned"], i["quantity"])}'
        return text + (f' | tags: {"; ".join(i["tags"])}' if i.get("tags") else "")

    return "\n".join(lines + _sections(items, line)) + "\n"


def missing_text(items: list[dict], printings: bool = True) -> str:
    """The copies not in the collection: a shopping list. Without printings, just '1 Name' lines,
    which shops with their own set codes (CardTrader...) match by name."""
    missing = [
        {**i, "quantity": i["quantity"] - i["owned"]} for i in items if i["owned"] < i["quantity"]
    ]
    if not missing:
        return ""
    if printings:
        return plain_text(missing)
    return "\n".join(f'{i["quantity"]} {i["card"]["name"]}' for i in sorted(missing, key=lambda i: i["card"]["name"])) + "\n"


def tokens_text(tokens: list[dict], only_missing: bool = False) -> str:
    """Tokens, emblems and markers of a list (hidden ones left out), as '1 Name (SET) 123' lines."""
    shown = [t for t in tokens if not t["hidden"]]
    if only_missing:
        shown = [{**t, "quantity": t["quantity"] - t["owned"]} for t in shown if t["owned"] < t["quantity"]]
    return plain_text(shown) if shown else ""
