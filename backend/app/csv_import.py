"""Parsing of the ManaBox collection CSV export."""

import csv
import io

REQUIRED_COLUMNS = {"Binder Name", "Name", "Set code", "Collector number", "Quantity", "Scryfall ID"}


class CsvFormatError(ValueError):
    pass


def _bool(value: str | None) -> int:
    return 1 if (value or "").strip().lower() == "true" else 0


def _float(value: str | None) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _int(value: str | None, line: int) -> int:
    try:
        return int((value or "").strip())
    except ValueError as exc:
        raise CsvFormatError(f"Riga {line}: quantità non valida '{value}'") from exc


def parse_manabox_csv(content: bytes) -> list[dict]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CsvFormatError("Il file non è in UTF-8") from exc

    reader = csv.DictReader(io.StringIO(text))
    header = set(reader.fieldnames or [])
    missing = REQUIRED_COLUMNS - header
    if missing:
        raise CsvFormatError(
            "Non sembra un export di ManaBox: colonne mancanti " + ", ".join(sorted(missing))
        )

    rows = []
    for line, raw in enumerate(reader, start=2):
        name = (raw.get("Name") or "").strip()
        if not name:
            continue
        quantity = _int(raw.get("Quantity"), line)
        if quantity <= 0:
            continue
        rows.append(
            {
                "binder_name": (raw.get("Binder Name") or "").strip() or "Senza binder",
                "binder_type": (raw.get("Binder Type") or "").strip() or None,
                "name": name,
                "set_code": (raw.get("Set code") or "").strip().upper(),
                "set_name": (raw.get("Set name") or "").strip() or None,
                "collector_number": (raw.get("Collector number") or "").strip(),
                "finish": (raw.get("Foil") or "normal").strip().lower() or "normal",
                "rarity": (raw.get("Rarity") or "").strip().lower() or None,
                "quantity": quantity,
                "manabox_id": (raw.get("ManaBox ID") or "").strip() or None,
                "scryfall_id": (raw.get("Scryfall ID") or "").strip().lower() or None,
                "purchase_price": _float(raw.get("Purchase price")),
                "currency": (raw.get("Purchase price currency") or "").strip() or None,
                "condition": (raw.get("Condition") or "").strip() or None,
                "language": (raw.get("Language") or "").strip() or None,
                "misprint": _bool(raw.get("Misprint")),
                "altered": _bool(raw.get("Altered")),
                "signed": _bool(raw.get("Signed")),
                "proxy": _bool(raw.get("Proxy")),
                "added_at": (raw.get("Added") or "").strip() or None,
            }
        )
    if not rows:
        raise CsvFormatError("Il file non contiene carte")
    return rows


ROW_COLUMNS = [
    "binder_name", "binder_type", "name", "set_code", "set_name", "collector_number", "finish",
    "rarity", "quantity", "manabox_id", "scryfall_id", "purchase_price", "currency", "condition",
    "language", "misprint", "altered", "signed", "proxy", "added_at",
]
