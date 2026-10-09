import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import cards, config, db, importer
from .routers import collection, images, imports, lists, scryfall_proxy
from .scryfall import ScryfallError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    with db.session() as conn:
        cards.rebuild_slims_if_needed(conn)
    importer.resume_after_restart()
    yield


app = FastAPI(title="ManaBox Viewer", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)


@app.exception_handler(ScryfallError)
def scryfall_unavailable(_request: Request, exc: ScryfallError):
    # Scryfall down or unreachable even after retries: a gateway error, not a bug of ours.
    return JSONResponse({"detail": str(exc)}, status_code=502)


for module in (imports, collection, images, lists, scryfall_proxy):
    app.include_router(module.router)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built SPA (in Docker); unknown paths fall back to index.html for client-side routing.
if (config.STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=config.STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        candidate = (config.STATIC_DIR / path).resolve()
        if path and candidate.is_file() and config.STATIC_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(config.STATIC_DIR / "index.html")
