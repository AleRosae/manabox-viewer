import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, cubecobra, db, scryfall
from app.cubecobra import CubeCobraClient
from app.scryfall import ScryfallClient


def fake_card(card_id: str, name: str, set_code: str = "tst", number: str = "1", **extra) -> dict:
    card = {
        "id": card_id,
        "oracle_id": extra.pop("oracle_id", str(uuid.uuid5(uuid.NAMESPACE_DNS, name))),
        "name": name,
        "lang": "en",
        "layout": "normal",
        "mana_cost": "{1}{U}",
        "cmc": 2.0,
        "type_line": "Instant",
        "oracle_text": "Draw a card.",
        "colors": ["U"],
        "color_identity": ["U"],
        "keywords": [],
        "rarity": "common",
        "set": set_code,
        "set_name": "Test Set",
        "collector_number": number,
        "legalities": {"legacy": "legal", "standard": "not_legal"},
        "prices": {"eur": "1.50", "eur_foil": None, "usd": "2.00"},
        "image_uris": {"normal": f"https://img.test/{card_id}.jpg", "large": f"https://img.test/{card_id}-l.jpg"},
    }
    card.update(extra)
    return card


class FakeScryfall:
    """In-memory Scryfall: cards indexed by id and by (set, collector_number)."""

    def __init__(self):
        self.cards: dict[str, dict] = {}
        self.calls: list[str] = []
        # Outages: the next requests answer these (a status code or an exception), then `down` forever.
        self.failures: list[int | Exception] = []
        self.down: int | Exception | None = None

    def add(self, card: dict) -> dict:
        self.cards[card["id"]] = card
        return card

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(f"{request.method} {request.url.path}")
        failure = self.failures.pop(0) if self.failures else self.down
        if isinstance(failure, Exception):
            raise failure
        if failure is not None:
            return httpx.Response(failure, text="Scryfall is down")
        path = request.url.path
        if path == "/cards/collection":
            data, missing = [], []
            for ident in json.loads(request.content)["identifiers"]:
                if "id" in ident:
                    card = self.cards.get(ident["id"])
                elif "name" in ident:
                    card = next((c for c in self.cards.values() if c["name"].lower() == ident["name"].lower()), None)
                else:
                    card = next(
                        (c for c in self.cards.values()
                         if c["set"] == ident["set"] and c["collector_number"] == ident["collector_number"]),
                        None,
                    )
                (data.append(card) if card else missing.append(ident))
            return httpx.Response(200, json={"data": data, "not_found": missing})
        if path.startswith("/cards/named"):
            if "exact" in request.url.params:
                name = request.url.params["exact"]
                card = next((c for c in self.cards.values() if c["name"] == name), None)
            else:
                fuzzy = request.url.params["fuzzy"].lower()
                card = next((c for c in self.cards.values() if fuzzy in c["name"].lower()), None)
            return httpx.Response(200, json=card) if card else httpx.Response(404, json={})
        if path.startswith("/cards/"):
            card = self.cards.get(path.rsplit("/", 1)[1])
            return httpx.Response(200, json=card) if card else httpx.Response(404, json={})
        if request.url.host == "img.test":
            return httpx.Response(200, content=b"\xff\xd8fake-jpeg")
        return httpx.Response(404, json={})


@pytest.fixture
def fake_scryfall(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.sqlite3")
    monkeypatch.setattr(config, "IMAGES_DIR", tmp_path / "images")
    fake = FakeScryfall()
    http = httpx.Client(base_url="https://api.scryfall.test", transport=httpx.MockTransport(fake.handler))
    scryfall.set_client(ScryfallClient(http=http, delay=0, backoff=0))
    db.init_db()
    yield fake
    scryfall.set_client(None)


@pytest.fixture
def api(fake_scryfall, monkeypatch):
    # Run enrichment synchronously so tests can assert on the final state.
    from app import importer
    monkeypatch.setattr(importer, "start_enrichment", lambda import_id: importer.enrich_import(import_id))
    from app.main import app
    with TestClient(app) as client:
        yield client


class FakeCubeCobra:
    """Public cubes by id, in the shape of /cube/api/cubeJSON/<id>."""

    def __init__(self):
        self.cubes: dict[str, dict] = {}

    def add(self, cube_id: str, name: str, cards: list[tuple]) -> None:
        """cards: (scryfall id, tags[, status]) per copy; the status defaults to Owned."""
        self.cubes[cube_id] = {
            "shortId": cube_id,
            "name": name,
            "cards": {"mainboard": [{"cardID": c[0], "tags": c[1], "status": c[2] if len(c) > 2 else "Owned",
                                     "details": {"name": c[0]}} for c in cards],
                      "maybeboard": []},
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        cube_id = request.url.path.rsplit("/", 1)[1]
        cube = self.cubes.get(cube_id)
        return httpx.Response(200, json=cube) if cube else httpx.Response(404, text="Not found")


@pytest.fixture
def fake_cubecobra():
    fake = FakeCubeCobra()
    http = httpx.Client(base_url="https://cubecobra.test", transport=httpx.MockTransport(fake.handler))
    cubecobra.set_client(CubeCobraClient(http=http))
    yield fake
    cubecobra.set_client(None)
