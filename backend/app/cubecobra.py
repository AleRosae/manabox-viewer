"""Read-only CubeCobra client: fetches a public cube's mainboard to link it to a list."""

import re
import sqlite3

import httpx

from . import config
from .cards import fetch_by_identifiers, get_card_data, oracle_id_of
from .list_import import normalize_tags
from .scryfall import UUID_RE, ScryfallClient

# "https://cubecobra.com/cube/list/vintagecube?view=table" -> "vintagecube"
URL_RE = re.compile(r"cubecobra\.com/cube/[A-Za-z]+/(?P<id>[A-Za-z0-9_-]+)", re.IGNORECASE)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


# CubeCobra's per-copy statuses, in the order copies are paired with the collection on export.
STATUSES = ["Premium Owned", "Owned", "Proxied", "Borrowed", "Ordered", "Not Owned"]
# The copy is physically in the cube: in the app, proxied or owned makes no difference.
IN_CUBE = {"Premium Owned", "Owned", "Proxied", "Borrowed"}
# Statuses that mean a real copy: kept on export for the copies the collection covers.
REAL = {"Premium Owned", "Owned"}


def sort_statuses(statuses: list[str]) -> list[str]:
    """Known statuses only, in STATUSES order (so two lists compare regardless of copy order)."""
    return sorted((s for s in statuses if s in STATUSES), key=STATUSES.index)


def in_cube_count(statuses: list[str] | None) -> int | None:
    return None if statuses is None else sum(1 for s in statuses if s in IN_CUBE)


class CubeCobraError(RuntimeError):
    pass


def parse_cube_ref(text: str) -> str | None:
    """A cube id from a CubeCobra URL or a bare id; None when it is neither."""
    text = text.strip()
    m = URL_RE.search(text)
    if m:
        return m.group("id")
    return text if ID_RE.match(text) else None


def cube_url(cube_id: str) -> str:
    return f"{config.CUBECOBRA_URL}/cube/list/{cube_id}"


class CubeCobraClient:
    def __init__(self, http: httpx.Client | None = None):
        self.http = http or httpx.Client(
            base_url=config.CUBECOBRA_URL,
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            timeout=30,
            follow_redirects=True,
        )

    def fetch_cube(self, cube_id: str) -> dict:
        """{id, name, cards: [{scryfall_id, name, tags, status}]} — mainboard only, one entry per copy."""
        try:
            resp = self.http.get(f"/cube/api/cubeJSON/{cube_id}")
        except httpx.HTTPError as exc:
            raise CubeCobraError(f"CubeCobra unreachable: {exc}") from exc
        if resp.status_code == 404:
            raise CubeCobraError("Cube not found (or private)")
        if resp.status_code != 200:
            raise CubeCobraError(f"CubeCobra HTTP {resp.status_code}")
        try:
            body = resp.json()
        except ValueError as exc:
            # Private cubes answer with an HTML page instead of JSON.
            raise CubeCobraError("Cube not found (or private)") from exc
        if not isinstance(body, dict) or not isinstance(body.get("cards"), dict):
            raise CubeCobraError("Unexpected answer from CubeCobra")
        cards = body["cards"].get("mainboard") or []
        return {
            "id": body.get("shortId") or cube_id,
            "name": body.get("name") or cube_id,
            "cards": [
                {
                    "scryfall_id": c.get("cardID") or "",
                    "name": (c.get("details") or {}).get("name") or c.get("name") or c.get("cardID") or "?",
                    "tags": normalize_tags(c.get("tags") or []),
                    "status": c.get("status") if c.get("status") in STATUSES else "Not Owned",
                }
                for c in cards
            ],
        }


def resolve_cube(
    conn: sqlite3.Connection, client: ScryfallClient, cube: dict
) -> tuple[list[dict], list[str]]:
    """Group the cube's copies by card: [{oracle_id, card, quantity, tags, statuses}] plus unresolved names.

    Custom cards (no Scryfall id) and ids Scryfall does not know end up in the unresolved list.
    """
    ids = {c["scryfall_id"] for c in cube["cards"] if UUID_RE.match(c["scryfall_id"])}
    known = {i: d for i in ids if (d := get_card_data(conn, i)) is not None}
    missing = sorted(ids - known.keys())
    if missing:
        found, _ = fetch_by_identifiers(conn, client, [{"id": i} for i in missing])
        known.update({c["id"]: c for c in found})

    merged: dict[str, dict] = {}
    unresolved: list[str] = []
    for c in cube["cards"]:
        card = known.get(c["scryfall_id"])
        if card is None:
            unresolved.append(c["name"])
            continue
        oid = oracle_id_of(card)
        entry = merged.setdefault(oid, {"oracle_id": oid, "card": card, "quantity": 0, "tags": [], "statuses": []})
        entry["quantity"] += 1
        entry["statuses"] = sort_statuses(entry["statuses"] + [c["status"]])
        entry["tags"] = normalize_tags(entry["tags"] + c["tags"])
    return list(merged.values()), unresolved


_client: CubeCobraClient | None = None


def get_client() -> CubeCobraClient:
    global _client
    if _client is None:
        _client = CubeCobraClient()
    return _client


def set_client(client: CubeCobraClient | None) -> None:
    """Used by tests to inject a mocked client."""
    global _client
    _client = client
