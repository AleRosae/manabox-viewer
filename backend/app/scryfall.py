"""Minimal, polite Scryfall client (rate limited, retries on 429, 5xx and network errors)."""

import logging
import re
import threading
import time

import httpx

from . import config

log = logging.getLogger(__name__)

BATCH_SIZE = 75
# Transient answers worth retrying: rate limit, server errors, maintenance.
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_AFTER = 60.0
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class ScryfallError(RuntimeError):
    pass


class ScryfallClient:
    def __init__(
        self, http: httpx.Client | None = None, delay: float | None = None, retries: int = 5, backoff: float = 1.0
    ):
        self.http = http or httpx.Client(
            base_url=config.SCRYFALL_API,
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            timeout=30,
        )
        self.delay = config.SCRYFALL_DELAY if delay is None else delay
        # Waits between attempts double from `backoff` seconds: 1+2+4+8+16 = ~30s before giving up.
        self.retries = retries
        self.backoff = backoff
        self._lock = threading.Lock()
        self._last = 0.0

    def _retry_after(self, resp: httpx.Response) -> float | None:
        try:
            return min(float(resp.headers["Retry-After"]), MAX_RETRY_AFTER)
        except (KeyError, ValueError):
            return None

    def _request(self, method: str, url: str, *, retries: int | None = None, **kwargs) -> httpx.Response:
        retries = self.retries if retries is None else retries
        error, wait_next = "", None
        for attempt in range(retries + 1):
            if attempt:
                time.sleep(wait_next if wait_next is not None else self.backoff * 2 ** (attempt - 1))
            # Scryfall asks for 50-100ms between requests; we serialise all calls.
            with self._lock:
                wait = self._last + self.delay - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    resp = self.http.request(method, url, **kwargs)
                except httpx.TransportError as exc:
                    resp = None
                    error = f"Scryfall unreachable ({type(exc).__name__})"
                finally:
                    self._last = time.monotonic()
            if resp is None:
                wait_next = None
            elif resp.status_code in RETRY_STATUSES:
                error = f"Scryfall HTTP {resp.status_code}"
                wait_next = self._retry_after(resp)
            else:
                return resp
            if attempt < retries:
                log.warning("%s on %s %s, retrying (%d/%d)", error, method, url, attempt + 1, retries)
        raise ScryfallError(f"{error} after {retries + 1} attempts")

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
        # Someone is typing: one quick retry, then the suggestions are skipped.
        resp = self._request("GET", "/cards/autocomplete", params={"q": q}, retries=1)
        if resp.status_code != 200:
            raise ScryfallError(f"/cards/autocomplete HTTP {resp.status_code}")
        return resp.json().get("data", [])

    def prints(self, oracle_id: str, max_pages: int = 5) -> list[dict]:
        """Every printing of a card, newest first (Scryfall pages them by 175)."""
        url: str | None = "/cards/search"
        params: dict | None = {"q": f"oracleid:{oracle_id}", "unique": "prints", "order": "released"}
        cards: list[dict] = []
        for _ in range(max_pages):
            resp = self._request("GET", url, params=params)
            if resp.status_code == 404:  # no match
                break
            if resp.status_code != 200:
                raise ScryfallError(f"/cards/search HTTP {resp.status_code}")
            body = resp.json()
            cards.extend(body.get("data", []))
            url, params = (body.get("next_page"), None) if body.get("has_more") else (None, None)
            if not url:
                break
        return cards

    def download(self, url: str) -> bytes:
        # Image CDN (cards.scryfall.io) is not rate limited like the API, but we stay polite.
        try:
            resp = self.http.get(url, follow_redirects=True)
        except httpx.TransportError as exc:
            raise ScryfallError(f"Image download failed ({type(exc).__name__})") from exc
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
