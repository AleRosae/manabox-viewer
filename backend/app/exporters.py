"""List exporters (CubeCobra CSV and plain text)."""

import csv
import io

# Header of CubeCobra's own CSV export, which its "Replace with CSV file upload" accepts back.
CUBECOBRA_HEADER = [
    "name", "CMC", "Type", "Color", "Set", "Collector Number", "Rarity", "Color Category",
    "status", "Finish", "maybeboard", "image URL", "image Back URL", "tags", "Notes", "MTGO ID",
]


def cubecobra_csv(items: list[dict]) -> str:
    """items: [{card: slim, quantity, owned}] — CubeCobra wants one row per copy."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CUBECOBRA_HEADER)
    for item in sorted(items, key=lambda i: i["card"]["name"]):
        card = item["card"]
        status = "Owned" if item["owned"] >= item["quantity"] else "Not Owned"
        row = [
            card["name"],
            f"{card['cmc']:g}",
            card["type_line"],
            "".join(card["colors"] or []),
            card["set"],
            card["collector_number"],
            card["rarity"],
            "",
            status,
            "Non-foil",
            "false",
            "", "", "", "", "",
        ]
        for _ in range(item["quantity"]):
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
    """The app's own sharing format: the plain text lines plus the exporter's owned copies.

    Everything after '|' is ignored by tools that only read '1 Name (SET) 123'.
    """
    lines = [VIEWER_MAGIC, f"# name: {lst['name']}", f"# kind: {lst['kind']}", f"# exported: {exported_on}"]
    for i in sorted(items, key=lambda i: i["card"]["name"]):
        card = i["card"]
        owned = min(i["owned"], i["quantity"])
        lines.append(f'{i["quantity"]} {card["name"]} ({card["set"].upper()}) {card["collector_number"]} | owned {owned}')
    return "\n".join(lines) + "\n"


def missing_text(items: list[dict]) -> str:
    """Plain text of the copies not in the collection: a shopping list."""
    missing = [
        {**i, "quantity": i["quantity"] - i["owned"]} for i in items if i["owned"] < i["quantity"]
    ]
    return plain_text(missing) if missing else ""
