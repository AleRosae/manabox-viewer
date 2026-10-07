import re
import sqlite3
import threading

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from .. import config, db
from ..cards import ensure_card
from ..scryfall import ScryfallError, get_client

router = APIRouter(prefix="/api", tags=["images"])

_ID_RE = re.compile(r"^[0-9a-f-]{36}$")
_download_sem = threading.Semaphore(6)
CACHE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}


def _image_url(card: dict, size: str, face: int) -> str | None:
    faces = card.get("card_faces") or []
    if face < len(faces) and "image_uris" in faces[face]:
        return faces[face]["image_uris"].get(size)
    # Single-image layouts (split, flip, adventure) only have a top-level image.
    return (card.get("image_uris") or {}).get(size)


@router.get("/images/{scryfall_id}")
def image(
    scryfall_id: str,
    size: str = Query("normal", pattern="^(small|normal|large)$"),
    face: int = Query(0, ge=0, le=1),
    conn: sqlite3.Connection = Depends(db.get_conn),
):
    if not _ID_RE.match(scryfall_id):
        raise HTTPException(400, "ID non valido")
    path = config.IMAGES_DIR / size / f"{scryfall_id}_{face}.jpg"
    if path.exists():
        return FileResponse(path, media_type="image/jpeg", headers=CACHE_HEADERS)

    try:
        card = ensure_card(conn, get_client(), scryfall_id)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    if card is None:
        raise HTTPException(404, "Carta non trovata")
    url = _image_url(card, size, face)
    if not url:
        raise HTTPException(404, "Immagine non disponibile")

    with _download_sem:
        if not path.exists():
            try:
                content = get_client().download(url)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(502, f"Download immagine fallito: {exc}") from exc
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
            tmp.write_bytes(content)
            tmp.replace(path)
    return FileResponse(path, media_type="image/jpeg", headers=CACHE_HEADERS)
