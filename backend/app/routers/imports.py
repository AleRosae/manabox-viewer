import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from .. import config, db, importer
from ..csv_import import CsvFormatError, parse_manabox_csv

router = APIRouter(prefix="/api", tags=["imports"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _import_dict(row) -> dict | None:
    return dict(row) if row else None


@router.get("/status")
def status(conn: sqlite3.Connection = Depends(db.get_conn)):
    current = db.latest_ready_import(conn)
    latest = conn.execute("SELECT * FROM imports ORDER BY id DESC LIMIT 1").fetchone()
    pending = latest if latest and (current is None or latest["id"] > current["id"]) else None
    return {
        "current_import": _import_dict(current),
        "pending_import": _import_dict(pending),
        "usd_to_eur": config.USD_TO_EUR,
        "prices": importer.price_job,
    }


@router.post("/imports", status_code=201)
async def upload(file: UploadFile, conn: sqlite3.Connection = Depends(db.get_conn)):
    running = conn.execute("SELECT id FROM imports WHERE status = 'enriching'").fetchone()
    if running:
        raise HTTPException(409, "An import is already running")
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    try:
        rows = parse_manabox_csv(content)
    except CsvFormatError as exc:
        raise HTTPException(422, str(exc)) from exc
    import_id = importer.create_import(conn, file.filename or "export.csv", rows)
    importer.start_enrichment(import_id)
    return {"id": import_id}


@router.get("/imports/{import_id}")
def get_import(import_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    row = conn.execute("SELECT * FROM imports WHERE id = ?", (import_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Import not found")
    return dict(row)


@router.get("/imports/{import_id}/diff")
def get_diff(import_id: int, conn: sqlite3.Connection = Depends(db.get_conn)):
    row = conn.execute("SELECT * FROM import_diffs WHERE import_id = ?", (import_id,)).fetchone()
    if not row:
        return None
    return {"previous_import_id": row["previous_import_id"], **json.loads(row["diff_json"])}


@router.post("/prices/refresh", status_code=202)
def refresh_prices():
    if not importer.start_price_refresh():
        raise HTTPException(409, "A price refresh is already running")
    return importer.price_job
