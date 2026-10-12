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

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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


# Lists, cubes and decks: one table, `kind` tells them apart.
LISTS_SCHEMA = """
CREATE TABLE lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,                     -- cube | deck
    format TEXT,                            -- decks only: commander, modern, ... or 'none'
    shared_by TEXT,                         -- set when imported from someone else's list
    remote_source TEXT,                     -- cubecobra | moxfield: the list syncs from there
    remote_id TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    board TEXT NOT NULL DEFAULT 'main',     -- commander | companion | main | side | maybe (cubes: main)
    oracle_id TEXT NOT NULL,
    preferred_scryfall_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    their_owned INTEGER,                    -- copies the sharer owned; NULL when unknown
    tags TEXT NOT NULL DEFAULT '[]',        -- JSON array of labels (CubeCobra tags)
    cube_statuses TEXT,                     -- JSON array: CubeCobra status of each copy; NULL when unknown
    added_at TEXT NOT NULL,
    UNIQUE (list_id, board, oracle_id)
);

-- Tokens are computed from the cards: this keeps only what the user changed.
CREATE TABLE list_tokens (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    oracle_id TEXT NOT NULL,
    quantity INTEGER,                       -- NULL: the default (1)
    hidden INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (list_id, oracle_id)
);
"""

# Columns the lists tables gained before schema versions existed: added before migrating them.
LEGACY_COLUMNS = [
    ("lists", "shared_by", "TEXT"),
    ("list_items", "their_owned", "INTEGER"),
    ("lists", "cubecobra_id", "TEXT"),
    ("lists", "synced_at", "TEXT"),
    ("list_items", "tags", "TEXT NOT NULL DEFAULT '[]'"),
    ("list_items", "cube_statuses", "TEXT"),
]


def _rename_legacy_db() -> None:
    current = config.DB_PATH
    legacy = current.with_name(config.LEGACY_DB_NAME)
    if current.exists() or not legacy.exists():
        return
    for suffix in ("", "-wal", "-shm"):
        src = legacy.with_name(legacy.name + suffix)
        if src.exists():
            src.rename(current.with_name(current.name + suffix))


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _create(conn: sqlite3.Connection, script: str) -> None:
    # Not executescript: it would commit the migration's transaction halfway.
    statement = ""
    for line in script.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            conn.execute(statement)
            statement = ""


def _migrate_1_cubes_and_decks(conn: sqlite3.Connection) -> None:
    """Lists become cubes or decks (generic lists turn into decks with no format) and items get a board."""
    if "lists" not in _tables(conn):
        _create(conn, LISTS_SCHEMA)
        return
    for table, column, definition in LEGACY_COLUMNS:
        if column not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    conn.execute("ALTER TABLE list_items RENAME TO list_items_v0")
    conn.execute("ALTER TABLE lists RENAME TO lists_v0")
    _create(conn, LISTS_SCHEMA)
    conn.execute(
        """INSERT INTO lists (id, name, description, kind, format, shared_by, remote_source, remote_id, synced_at,
                              created_at, updated_at)
           SELECT id, name, description,
                  -- lists linked to CubeCobra are cubes, whatever their kind was
                  CASE WHEN kind = 'cube' OR cubecobra_id IS NOT NULL THEN 'cube' ELSE 'deck' END,
                  CASE WHEN kind = 'cube' OR cubecobra_id IS NOT NULL THEN NULL ELSE 'none' END,
                  shared_by,
                  CASE WHEN cubecobra_id IS NULL THEN NULL ELSE 'cubecobra' END, cubecobra_id, synced_at,
                  created_at, updated_at
           FROM lists_v0"""
    )
    conn.execute(
        """INSERT INTO list_items (id, list_id, board, oracle_id, preferred_scryfall_id, quantity, their_owned, tags,
                                   cube_statuses, added_at)
           SELECT id, list_id, 'main', oracle_id, preferred_scryfall_id, quantity, their_owned, tags, cube_statuses,
                  added_at
           FROM list_items_v0 WHERE list_id IN (SELECT id FROM lists)"""
    )
    # Ids of deleted lists must not come back: old links and remembered lists would open another one.
    conn.execute(
        """INSERT INTO sqlite_sequence (name, seq)
           SELECT CASE name WHEN 'lists_v0' THEN 'lists' ELSE 'list_items' END, seq FROM sqlite_sequence
           WHERE name IN ('lists_v0', 'list_items_v0')"""
    )
    conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('lists', 'list_items') AND rowid NOT IN "
                 "(SELECT MAX(rowid) FROM sqlite_sequence GROUP BY name)")
    conn.execute("DROP TABLE list_items_v0")
    conn.execute("DROP TABLE lists_v0")


# Applied in order; the number of migrations applied is the schema version, stored in `meta`.
MIGRATIONS = [_migrate_1_cubes_and_decks]


def _schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    return int(row[0]) if row else 0


def init_db() -> None:
    _rename_legacy_db()
    with session() as conn:
        conn.executescript(SCHEMA)
        version = _schema_version(conn)
        if version >= len(MIGRATIONS):
            return
        # Tables are rebuilt: foreign keys are checked once at the end instead of on every statement,
        # and every migration runs in one transaction.
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN")
        for migrate in MIGRATIONS[version:]:
            migrate(conn)
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(len(MIGRATIONS)),),
        )
        if conn.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("Database migration left dangling references")
        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON")


def latest_ready_import(conn: sqlite3.Connection):
    return conn.execute(
        "SELECT * FROM imports WHERE status = 'ready' ORDER BY id DESC LIMIT 1"
    ).fetchone()
