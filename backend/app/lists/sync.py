"""Sync a list with a remote copy (a CubeCobra cube, a Moxfield deck): diff, then apply.

Sources turn what they read into a Snapshot; the remote decides which cards, on which board and
how many copies. Local choices stay: the printing, tags (remote tags are added to them) and the
boards the snapshot does not know about.
"""

import json
import sqlite3
from dataclasses import dataclass, field

from fastapi import HTTPException

from ..cards import get_slims, now_iso
from ..list_import import normalize_tags
from ..sources.cubecobra import in_cube_count
from .store import BOARDS, board_rank, owned_by_oracle


@dataclass
class Snapshot:
    source: str  # cubecobra | moxfield
    id: str
    name: str
    url: str
    # [{oracle_id, board, card (Scryfall data), quantity, tags?, statuses?}]; tags and statuses are None
    # when the source has none (they are then left alone)
    entries: list[dict]
    unresolved: list[str] = field(default_factory=list)
    # boards the source lists (the others are left alone, e.g. a commander set here but absent from a pasted export)
    boards: set[str] = field(default_factory=lambda: set(BOARDS))
    # deck format read from the source, if any
    format: str | None = None


def _key(board: str, oracle_id: str) -> tuple[str, str]:
    return board, oracle_id


def sync(conn: sqlite3.Connection, list_row: sqlite3.Row, snap: Snapshot, apply: bool) -> dict:
    list_id = list_row["id"]
    if not snap.entries:
        # Never let an empty (or unreadable) remote wipe the list.
        raise HTTPException(502, f"No recognisable cards in “{snap.name}”")

    rows = [dict(r) for r in conn.execute("SELECT * FROM list_items WHERE list_id = ?", (list_id,))]
    current = {_key(r["board"], r["oracle_id"]): r for r in rows if r["board"] in snap.boards}
    # A card kept on a board the remote doesn't list (a commander missing from a pasted export) is not
    # added again to the boards the remote lists; its copies already there are synced as usual.
    pinned = {r["oracle_id"] for r in rows if r["board"] not in snap.boards}
    incoming: dict[tuple[str, str], dict] = {}
    for e in snap.entries:
        key = _key(e["board"], e["oracle_id"])
        if e["board"] in snap.boards and (key in current or e["oracle_id"] not in pinned):
            incoming[key] = e

    names = {sid: c["name"] for sid, c in get_slims(conn, (r["preferred_scryfall_id"] for r in rows)).items()}
    owned = owned_by_oracle(conn)

    added = [e for k, e in incoming.items() if k not in current]
    removed = [r for k, r in current.items() if k not in incoming]
    # A card leaving a board for another one is a move: it keeps its printing and tags.
    leaving: dict[str, list[dict]] = {}
    for r in removed:
        leaving.setdefault(r["oracle_id"], []).append(r)
    moved = [(leaving[e["oracle_id"]].pop(), e) for e in added if leaving.get(e["oracle_id"])]
    moved_rows = {id(r) for r, _ in moved}
    moved_entries = {id(e) for _, e in moved}
    added = [e for e in added if id(e) not in moved_entries]
    removed = [r for r in removed if id(r) not in moved_rows]

    changed, retagged, restatused = [], [], []
    for k, e in incoming.items():
        if k not in current:
            continue
        row = current[k]
        if row["quantity"] != e["quantity"]:
            changed.append((row, e))
        if e.get("tags") is not None:
            local = json.loads(row["tags"])
            merged = normalize_tags(local + e["tags"])
            if len(merged) > len(local):
                retagged.append((row, merged, merged[len(local):]))
        if e.get("statuses") is not None:
            before = json.loads(row["cube_statuses"]) if row["cube_statuses"] else None
            if before != e["statuses"]:
                restatused.append((row, before, e["statuses"]))

    new_format = snap.format if snap.format and snap.format != list_row["format"] else None

    if apply:
        ts = now_iso()
        conn.executemany("DELETE FROM list_items WHERE id = ?", [(r["id"],) for r in removed] + [(r["id"],) for r, _ in moved])
        conn.executemany(
            # ON CONFLICT: a concurrent sync may have added the card in the meantime.
            """INSERT INTO list_items (list_id, board, oracle_id, preferred_scryfall_id, quantity, tags, cube_statuses, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (list_id, board, oracle_id) DO UPDATE SET quantity = excluded.quantity""",
            [
                (list_id, e["board"], e["oracle_id"], e["card"]["id"], e["quantity"], json.dumps(e.get("tags") or []),
                 json.dumps(e["statuses"]) if e.get("statuses") is not None else None, ts)
                for e in added
            ] + [
                (list_id, e["board"], e["oracle_id"], r["preferred_scryfall_id"], e["quantity"],
                 json.dumps(normalize_tags(json.loads(r["tags"]) + (e.get("tags") or []))),
                 json.dumps(e["statuses"]) if e.get("statuses") is not None else r["cube_statuses"], r["added_at"])
                for r, e in moved
            ],
        )
        conn.executemany("UPDATE list_items SET quantity = ? WHERE id = ?", [(e["quantity"], r["id"]) for r, e in changed])
        conn.executemany("UPDATE list_items SET tags = ? WHERE id = ?", [(json.dumps(t), r["id"]) for r, t, _ in retagged])
        conn.executemany(
            "UPDATE list_items SET cube_statuses = ? WHERE id = ?", [(json.dumps(new), r["id"]) for r, _, new in restatused]
        )
        conn.execute(
            """UPDATE lists SET remote_source = ?, remote_id = ?, synced_at = ?, updated_at = ?,
                                format = COALESCE(?, format) WHERE id = ?""",
            (snap.source, snap.id, ts, ts, new_format, list_id),
        )

    def name_of(row: dict) -> str:
        return names.get(row["preferred_scryfall_id"], "?")

    def by_name(lines):
        return sorted(lines, key=lambda x: (board_rank(x.get("board", "main")), x["name"]))

    # oracle_id (+ board) identifies each line: names can repeat (Un-cards, missing card data).
    return {
        "remote": {"source": snap.source, "id": snap.id, "name": snap.name, "url": snap.url},
        "applied": apply,
        "added": by_name(
            {"oracle_id": e["oracle_id"], "board": e["board"], "name": e["card"]["name"], "quantity": e["quantity"],
             "owned": owned.get(e["oracle_id"], 0)} for e in added
        ),
        "removed": by_name(
            {"oracle_id": r["oracle_id"], "board": r["board"], "name": name_of(r), "quantity": r["quantity"]} for r in removed
        ),
        "changed": by_name(
            {"oracle_id": r["oracle_id"], "board": r["board"], "name": name_of(r), "from": r["quantity"], "to": e["quantity"]}
            for r, e in changed
        ),
        "moved": by_name(
            {"oracle_id": r["oracle_id"], "board": e["board"], "from_board": r["board"], "name": name_of(r),
             "from": r["quantity"], "to": e["quantity"]}
            for r, e in moved
        ),
        "retagged": by_name(
            {"oracle_id": r["oracle_id"], "board": r["board"], "name": name_of(r), "tags": new} for r, _, new in retagged
        ),
        # CubeCobra's owned/proxied/... marks changed (or are new for this list): "from" is None when unknown
        "restatused": by_name(
            {"oracle_id": r["oracle_id"], "board": r["board"], "name": name_of(r), "from": in_cube_count(old),
             "to": in_cube_count(new), "quantity": len(new)}
            for r, old, new in restatused
        ),
        "format": {"from": list_row["format"], "to": new_format} if new_format else None,
        "unresolved": snap.unresolved,
        # boards the sync leaves alone because the remote doesn't list them
        "kept_boards": sorted({r["board"] for r in rows if r["board"] not in snap.boards}, key=board_rank),
        "list_size": len(current),
    }
