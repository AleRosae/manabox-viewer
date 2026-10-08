"""List exporters (CubeCobra CSV and plain text)."""

import csv
import io

from .cubecobra import REAL, STATUSES

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


def plain_text(items: list[dict]) -> str:
    """'1 Name (SET) 123' lines, accepted by CubeCobra, Moxfield and most deck tools."""
    lines = [
        f'{i["quantity"]} {i["card"]["name"]} ({i["card"]["set"].upper()}) {i["card"]["collector_number"]}'
        for i in sorted(items, key=lambda i: i["card"]["name"])
    ]
    return "\n".join(lines) + "\n"


VIEWER_MAGIC = "# ManaBox Viewer list v1"


def viewer_list(lst: dict, items: list[dict], exported_on: str) -> str:
    """The app's own sharing format: the plain text lines plus the exporter's owned copies and tags.

    Everything after '|' is ignored by tools that only read '1 Name (SET) 123'.
    """
    lines = [VIEWER_MAGIC, f"# name: {lst['name']}", f"# kind: {lst['kind']}", f"# exported: {exported_on}"]
    for i in sorted(items, key=lambda i: i["card"]["name"]):
        card = i["card"]
        owned = min(i["owned"], i["quantity"])
        line = f'{i["quantity"]} {card["name"]} ({card["set"].upper()}) {card["collector_number"]} | owned {owned}'
        if i.get("tags"):
            line += f' | tags: {"; ".join(i["tags"])}'
        lines.append(line)
    return "\n".join(lines) + "\n"


def missing_text(items: list[dict]) -> str:
    """Plain text of the copies not in the collection: a shopping list."""
    missing = [
        {**i, "quantity": i["quantity"] - i["owned"]} for i in items if i["owned"] < i["quantity"]
    ]
    return plain_text(missing) if missing else ""
