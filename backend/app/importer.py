"""Import pipeline: store CSV rows, diff against the previous import, enrich with Scryfall."""

import json
import logging
import sqlite3
import threading
from typing import Callable

from . import db
from .cards import cached_ids, fetch_by_identifiers, now_iso
from .csv_import import ROW_COLUMNS
from .scryfall import ScryfallClient, get_client

log = logging.getLogger(__name__)


def _diff_key(row) -> tuple:
    # Not the Scryfall id: enrichment may correct it on stored rows, while new CSV rows still have ManaBox's.
    return (
        row["name"], row["set_code"].lower(), row["collector_number"],
        row["binder_name"], row["finish"], row["language"] or "",
    )


def _describe(row, quantity: int) -> dict:
    return {
        "name": row["name"],
        "set_code": row["set_code"],
        "collector_number": row["collector_number"],
        "binder": row["binder_name"],
        "finish": row["finish"],
        "scryfall_id": row["scryfall_id"],
        "quantity": quantity,
    }


def compute_diff(previous: list, current: list) -> dict:
    def index(rows):
        out: dict[tuple, tuple] = {}
        for r in rows:
            key = _diff_key(r)
            first, qty = out.get(key, (r, 0))
            out[key] = (first, qty + r["quantity"])
        return out

    prev, cur = index(previous), index(current)
    added, removed, changed = [], [], []
    for key, (row, qty) in cur.items():
        if key not in prev:
            added.append(_describe(row, qty))
        elif prev[key][1] != qty:
            changed.append({**_describe(row, qty), "before": prev[key][1], "after": qty})
    for key, (row, qty) in prev.items():
        if key not in cur:
            removed.append(_describe(row, qty))
    for lst in (added, removed, changed):
        lst.sort(key=lambda d: (d["name"], d["binder"]))
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "summary": {
            "added_copies": sum(d["quantity"] for d in added)
            + sum(max(0, d["after"] - d["before"]) for d in changed),
            "removed_copies": sum(d["quantity"] for d in removed)
            + sum(max(0, d["before"] - d["after"]) for d in changed),
        },
    }


class ImportRunning(RuntimeError):
    pass


# One import at a time: enriching two would let the first to finish delete the other's rows.
_import_lock = threading.Lock()


def create_import(conn: sqlite3.Connection, filename: str, rows: list[dict]) -> int:
    with _import_lock:
        if conn.execute("SELECT 1 FROM imports WHERE status = 'enriching'").fetchone():
            raise ImportRunning("An import is already running")
        return _create_import(conn, filename, rows)


def _create_import(conn: sqlite3.Connection, filename: str, rows: list[dict]) -> int:
    previous = db.latest_ready_import(conn)
    cur = conn.execute(
        "INSERT INTO imports (filename, imported_at, row_count, total_quantity, status, progress) VALUES (?, ?, ?, ?, 'enriching', 0)",
        (filename, now_iso(), len(rows), sum(r["quantity"] for r in rows)),
    )
    import_id = cur.lastrowid
    conn.executemany(
        f"INSERT INTO collection_rows (import_id, {', '.join(ROW_COLUMNS)}) VALUES (?, {', '.join('?' * len(ROW_COLUMNS))})",
        [(import_id, *[r[c] for c in ROW_COLUMNS]) for r in rows],
    )
    if previous is not None:
        prev_rows = conn.execute("SELECT * FROM collection_rows WHERE import_id = ?", (previous["id"],)).fetchall()
        diff = compute_diff(prev_rows, rows)
        conn.execute(
            "INSERT INTO import_diffs (import_id, previous_import_id, diff_json) VALUES (?, ?, ?)",
            (import_id, previous["id"], json.dumps(diff)),
        )
    conn.commit()
    return import_id


def _set_progress(conn: sqlite3.Connection, import_id: int, progress: float) -> None:
    conn.execute("UPDATE imports SET progress = ? WHERE id = ?", (round(progress, 3), import_id))
    conn.commit()


def enrich_import(import_id: int, client: ScryfallClient | None = None) -> None:
    """Fetch the import's cards and make it the current collection.

    Cards Scryfall does not answer for (after retries) do not fail the import: their rows are kept
    and `retry_pending` fetches them later.
    """
    client = client or get_client()
    with db.session() as conn:
        try:
            _enrich(conn, import_id, client, progress=lambda p: _set_progress(conn, import_id, p))
            conn.execute("UPDATE imports SET status = 'ready', progress = 1 WHERE id = ?", (import_id,))
            # Only the latest import's rows are needed: older ones were already diffed.
            conn.execute("DELETE FROM collection_rows WHERE import_id < ?", (import_id,))
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI
            log.exception("Import %s failed", import_id)
            conn.rollback()
            conn.execute("UPDATE imports SET status = 'error', error = ? WHERE id = ?", (str(exc), import_id))
            conn.execute("DELETE FROM collection_rows WHERE import_id = ?", (import_id,))


def _enrich(
    conn: sqlite3.Connection, import_id: int, client: ScryfallClient, progress: Callable[[float], None] | None = None
) -> int:
    """Fetch the cards of the import's rows not cached yet; returns how many Scryfall did not answer for."""
    rows = conn.execute(
        "SELECT id, scryfall_id, set_code, collector_number, name FROM collection_rows WHERE import_id = ?",
        (import_id,),
    ).fetchall()
    cached = cached_ids(conn)
    wanted = sorted({r["scryfall_id"] for r in rows if r["scryfall_id"]} - cached)

    failed: list[dict] = []
    _, missing = fetch_by_identifiers(
        conn, client, [{"id": i} for i in wanted],
        progress=(lambda done, total: progress(0.95 * done / total)) if progress else None,
        failed=failed,
    )
    missing_ids = {m.get("id") for m in missing}
    failed_ids = {f["id"] for f in failed}

    # Fallback for rows whose Scryfall ID is absent or unknown: look up by set + collector number.
    unresolved = [r for r in rows if not r["scryfall_id"] or r["scryfall_id"] in missing_ids]
    if unresolved:
        idents = {(r["set_code"].lower(), r["collector_number"]) for r in unresolved}
        failed_prints: list[dict] = []
        found, _ = fetch_by_identifiers(
            conn, client, [{"set": s, "collector_number": n} for s, n in sorted(idents)], failed=failed_prints
        )
        by_print = {(c["set"].lower(), c["collector_number"]): c["id"] for c in found}
        unanswered = {(f["set"], f["collector_number"]) for f in failed_prints}
        for r in unresolved:
            key = (r["set_code"].lower(), r["collector_number"])
            new_id = by_print.get(key)
            if new_id:
                conn.execute("UPDATE collection_rows SET scryfall_id = ? WHERE id = ?", (new_id, r["id"]))
            elif key in unanswered:
                failed_ids.add(r["scryfall_id"])  # unknown yet: keep the id, retried later
            else:
                log.warning("Card not found on Scryfall: %s (%s %s)", r["name"], r["set_code"], r["collector_number"])
                conn.execute("UPDATE collection_rows SET scryfall_id = NULL WHERE id = ?", (r["id"],))
    conn.commit()
    if failed_ids:
        log.warning("Import %s: %d cards not fetched, Scryfall did not answer", import_id, len(failed_ids))
    return len(failed_ids)


def start_enrichment(import_id: int) -> None:
    threading.Thread(target=enrich_import, args=(import_id,), daemon=True, name=f"import-{import_id}").start()


# --- cards Scryfall did not answer for ---------------------------------------------------------

retry_job = {"status": "idle", "error": None}
_retry_lock = threading.Lock()


def pending_cards(conn: sqlite3.Connection) -> int:
    """Rows of the current collection whose card is not cached: Scryfall did not answer when importing."""
    current = db.latest_ready_import(conn)
    if current is None:
        return 0
    return conn.execute(
        """SELECT COUNT(*) FROM collection_rows r LEFT JOIN cards c ON c.scryfall_id = r.scryfall_id
           WHERE r.import_id = ? AND r.scryfall_id IS NOT NULL AND c.scryfall_id IS NULL""",
        (current["id"],),
    ).fetchone()[0]


def retry_pending(client: ScryfallClient | None = None) -> None:
    client = client or get_client()
    with db.session() as conn:
        try:
            current = db.latest_ready_import(conn)
            left = _enrich(conn, current["id"], client) if current else 0
            retry_job.update(status="idle", error=f"Scryfall still did not answer for {left} cards" if left else None)
        except Exception as exc:  # noqa: BLE001
            log.exception("Retrying pending cards failed")
            retry_job.update(status="error", error=str(exc))


def start_retry() -> bool:
    with _retry_lock:
        if retry_job["status"] == "running":
            return False
        retry_job.update(status="running", error=None)
    threading.Thread(target=retry_pending, daemon=True, name="retry-cards").start()
    return True


def resume_after_restart() -> None:
    """Resume the import a restart interrupted (its rows are stored, cached cards are not fetched
    again) and fetch the cards an earlier import could not get."""
    with db.session() as conn:
        interrupted = [r["id"] for r in conn.execute("SELECT id FROM imports WHERE status = 'enriching' ORDER BY id DESC")]
        for stale in interrupted[1:]:
            conn.execute("UPDATE imports SET status = 'error', error = 'Interrupted by a restart' WHERE id = ?", (stale,))
            conn.execute("DELETE FROM collection_rows WHERE import_id = ?", (stale,))
        pending = pending_cards(conn)
    if interrupted:
        log.info("Resuming import %s", interrupted[0])
        start_enrichment(interrupted[0])
    elif pending:
        log.info("Fetching %d cards Scryfall did not answer for", pending)
        start_retry()


# --- price refresh -------------------------------------------------------------------------

price_job = {"status": "idle", "progress": 0.0, "updated_at": None, "error": None}
_price_lock = threading.Lock()


def refresh_prices(client: ScryfallClient | None = None) -> None:
    client = client or get_client()
    with db.session() as conn:
        try:
            ids = sorted(
                {r[0] for r in conn.execute("SELECT DISTINCT scryfall_id FROM collection_rows WHERE scryfall_id IS NOT NULL")}
                | {r[0] for r in conn.execute("SELECT DISTINCT preferred_scryfall_id FROM list_items")}
            )

            def progress(done: int, total: int) -> None:
                price_job["progress"] = done / total

            failed: list[dict] = []
            fetch_by_identifiers(conn, client, [{"id": i} for i in ids], progress=progress, failed=failed)
            error = f"Scryfall did not answer for {len(failed)} of {len(ids)} cards: their prices are older" if failed else None
            price_job.update(status="idle", progress=1.0, updated_at=now_iso(), error=error)
        except Exception as exc:  # noqa: BLE001
            log.exception("Price refresh failed")
            price_job.update(status="error", error=str(exc))


def start_price_refresh() -> bool:
    with _price_lock:
        if price_job["status"] == "running":
            return False
        price_job.update(status="running", progress=0.0, error=None)
    threading.Thread(target=refresh_prices, daemon=True, name="prices").start()
    return True
