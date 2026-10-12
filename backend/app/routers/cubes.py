"""Cubes linked to CubeCobra: import preview and sync."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..lists import store
from ..lists.sync import Snapshot, sync
from ..scryfall import ScryfallError, get_client
from ..sources import cubecobra
from ..sources.cubecobra import CubeCobraError, parse_cube_ref, resolve_cube

router = APIRouter(prefix="/api/cubes", tags=["cubes"])


class CubePreviewIn(BaseModel):
    url: str = Field(min_length=1, max_length=300)


class SyncIn(BaseModel):
    cube: str | None = Field(None, max_length=300)  # link to this cube instead of the stored one
    apply: bool = False


def _cube_id(text: str) -> str:
    cube_id = parse_cube_ref(text)
    if cube_id is None:
        raise HTTPException(422, "Not a CubeCobra cube URL or id")
    return cube_id


def _snapshot(conn: sqlite3.Connection, cube_id: str) -> Snapshot:
    try:
        cube = cubecobra.get_client().fetch_cube(cube_id)
    except CubeCobraError as exc:
        raise HTTPException(502, str(exc)) from exc
    try:
        entries, unresolved = resolve_cube(conn, get_client(), cube)
    except ScryfallError as exc:
        raise HTTPException(502, str(exc)) from exc
    return Snapshot("cubecobra", cube["id"], cube["name"], cubecobra.cube_url(cube["id"]), entries, unresolved, {"main"})


@router.post("/cubecobra/preview")
def cubecobra_preview(body: CubePreviewIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Fetch a CubeCobra cube and compare it with the collection, without saving anything."""
    snap = _snapshot(conn, _cube_id(body.url))
    items = store.preview_items(snap.entries, store.owned_by_oracle(conn))
    items.sort(key=lambda i: i["card"]["name"])
    return {
        "meta": {"name": snap.name, "kind": "cube", "format": None, "has_ownership": False,
                 "remote": {"source": "cubecobra", "id": snap.id}},
        "items": items,
        "unresolved": snap.unresolved,
    }


@router.post("/{list_id}/sync")
def sync_cube(list_id: int, body: SyncIn, conn: sqlite3.Connection = Depends(db.get_conn)):
    """Diff the cube against CubeCobra; with apply, make the cards match it.

    CubeCobra decides which cards, how many copies and their statuses; tags are merged (local
    ones are kept) and the printing chosen locally is preserved.
    """
    lst = store.get_list(conn, list_id, kind="cube")
    linked = lst["remote_id"] if lst["remote_source"] == "cubecobra" else None
    cube_id = _cube_id(body.cube) if body.cube else linked
    if not cube_id:
        raise HTTPException(422, "The cube is not linked to CubeCobra")
    return sync(conn, lst, _snapshot(conn, cube_id), body.apply)
