import sqlite3
from contextlib import contextmanager
from typing import Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    total_quantity INTEGER NOT NULL,
    status TEXT NOT NULL,            -- enriching | ready | error
    progress REAL NOT NULL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS collection_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    binder_name TEXT NOT NULL,
    binder_type TEXT,
    name TEXT NOT NULL,
    set_code TEXT NOT NULL,
    set_name TEXT,
    collector_number TEXT NOT NULL,
    finish TEXT NOT NULL,
    rarity TEXT,
    quantity INTEGER NOT NULL,
    manabox_id TEXT,
    scryfall_id TEXT,
    purchase_price REAL,
    currency TEXT,
    condition TEXT,
    language TEXT,
    misprint INTEGER NOT NULL DEFAULT 0,
    altered INTEGER NOT NULL DEFAULT 0,
    signed INTEGER NOT NULL DEFAULT 0,
    proxy INTEGER NOT NULL DEFAULT 0,
    added_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_rows_import ON collection_rows(import_id);

CREATE TABLE IF NOT EXISTS cards (
    scryfall_id TEXT PRIMARY KEY,
    oracle_id TEXT,
    name TEXT NOT NULL,
    data_json TEXT NOT NULL,
    slim_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cards_oracle ON cards(oracle_id);

CREATE TABLE IF NOT EXISTS import_diffs (
    import_id INTEGER PRIMARY KEY REFERENCES imports(id) ON DELETE CASCADE,
    previous_import_id INTEGER,
    diff_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'generic',   -- cube | generic
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    oracle_id TEXT NOT NULL,
    preferred_scryfall_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    UNIQUE (list_id, oracle_id)
);
"""


def connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Connections are per request, but sync dependencies and async endpoints may run on different threads.
    conn = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_conn() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency."""
    with session() as conn:
        yield conn


def init_db() -> None:
    with session() as conn:
        conn.executescript(SCHEMA)
        # An import interrupted by a restart can never finish: mark it as failed.
        conn.execute(
            "UPDATE imports SET status = 'error', error = 'Interrotto dal riavvio' WHERE status = 'enriching'"
        )


def latest_ready_import(conn: sqlite3.Connection):
    return conn.execute(
        "SELECT * FROM imports WHERE status = 'ready' ORDER BY id DESC LIMIT 1"
    ).fetchone()
