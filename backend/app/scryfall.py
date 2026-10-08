"""Minimal, polite Scryfall client (rate limited, retries on 429)."""

import threading
import time

import httpx

from . import config

BATCH_SIZE = 75


class ScryfallError(RuntimeError):
    pass


class ScryfallClient:
    def __init__(self, http: httpx.Client | None = None, delay: float | None = None):
        self.http = http or httpx.Client(
            base_url=config.SCRYFALL_API,
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            timeout=30,
        )
        self.delay = config.SCRYFALL_DELAY if delay is None else delay
        self._lock = threading.Lock()
        self._last = 0.0

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        for attempt in range(4):
            # Scryfall asks for 50-100ms between requests; we serialise all calls.
            with self._lock:
                wait = self._last + self.delay - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                resp = self.http.request(method, url, **kwargs)
                self._last = time.monotonic()
            if resp.status_code == 429:
                time.sleep(1 + attempt * 2)
                continue
            return resp
        raise ScryfallError("Scryfall rate limit: too many retries")

    def collection(self, identifiers: list[dict]) -> tuple[list[dict], list[dict]]:
        """POST /cards/collection with at most 75 identifiers."""
        resp = self._request("POST", "/cards/collection", json={"identifiers": identifiers})
        if resp.status_code != 200:
            raise ScryfallError(f"/cards/collection HTTP {resp.status_code}: {resp.text[:200]}")
        body = resp.json()
        return body.get("data", []), body.get("not_found", [])

    def card(self, scryfall_id: str) -> dict | None:
        resp = self._request("GET", f"/cards/{scryfall_id}")
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise ScryfallError(f"/cards/{scryfall_id} HTTP {resp.status_code}")
        return resp.json()

    def named(self, exact: str | None = None, *, fuzzy: str | None = None) -> dict | None:
        params = {"exact": exact} if exact is not None else {"fuzzy": fuzzy}
        resp = self._request("GET", "/cards/named", params=params)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise ScryfallError(f"/cards/named HTTP {resp.status_code}")
        return resp.json()

    def autocomplete(self, q: str) -> list[str]:
        resp = self._request("GET", "/cards/autocomplete", params={"q": q})
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    def prints(self, oracle_id: str) -> list[dict]:
        resp = self._request(
            "GET", "/cards/search",
            params={"q": f"oracleid:{oracle_id}", "unique": "prints", "order": "released"},
        )
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    def download(self, url: str) -> bytes:
        # Image CDN (cards.scryfall.io) is not rate limited like the API, but we stay polite.
        resp = self.http.get(url, follow_redirects=True)
        if resp.status_code != 200:
            raise ScryfallError(f"Image HTTP {resp.status_code}")
        return resp.content


_client: ScryfallClient | None = None


def get_client() -> ScryfallClient:
    global _client
    if _client is None:
        _client = ScryfallClient()
    return _client


def set_client(client: ScryfallClient | None) -> None:
    """Used by tests to inject a mocked client."""
    global _client
    _client = client
