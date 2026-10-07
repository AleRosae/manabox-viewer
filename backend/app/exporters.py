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
