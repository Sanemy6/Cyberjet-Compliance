"""Accès SQLite : connexion, schéma et helpers de requêtage.

Pas d'ORM volontairement : le schéma est petit, stable, et le SQL direct reste
plus lisible pour un prototype que l'on fera évoluer souvent.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "grc.db"


def now() -> str:
    """Horodatage ISO 8601 UTC, stocké en texte (tri lexicographique = tri chrono)."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    country     TEXT,
    contact     TEXT,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'actif',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS framework (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    version     TEXT,
    authority   TEXT,
    description TEXT,
    accent      TEXT NOT NULL DEFAULT 'slate',
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS control (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    framework_id INTEGER NOT NULL REFERENCES framework(id) ON DELETE CASCADE,
    ref          TEXT NOT NULL,
    title        TEXT NOT NULL,
    theme        TEXT,
    description  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (framework_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_control_framework ON control(framework_id);

-- Base de connaissance : une entrée = une question récurrente + sa réponse validée.
-- client_id NULL  => réponse générique (patrimoine commun, réutilisable pour tous).
CREATE TABLE IF NOT EXISTS kb_entry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER REFERENCES client(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Général',
    tags        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'validated',
    evidence    TEXT,
    source      TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kb_client ON kb_entry(client_id);

CREATE TABLE IF NOT EXISTS kb_control (
    kb_entry_id INTEGER NOT NULL REFERENCES kb_entry(id) ON DELETE CASCADE,
    control_id  INTEGER NOT NULL REFERENCES control(id) ON DELETE CASCADE,
    PRIMARY KEY (kb_entry_id, control_id)
);

-- Configurations techniques propres à chaque client (chiffrement, IAM, réseau...).
-- Indexées comme la base de connaissance : elles répondent directement aux
-- questions factuelles du type « quel algorithme de chiffrement au repos ? ».
CREATE TABLE IF NOT EXISTS config_item (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    category   TEXT NOT NULL DEFAULT 'Chiffrement',
    label      TEXT NOT NULL,
    value      TEXT NOT NULL,
    details    TEXT,
    scope      TEXT,
    status     TEXT NOT NULL DEFAULT 'en place',
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_client ON config_item(client_id);

CREATE TABLE IF NOT EXISTS questionnaire (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    original_filename TEXT,
    stored_path       TEXT,
    file_type         TEXT NOT NULL DEFAULT 'xlsx',
    status            TEXT NOT NULL DEFAULT 'en cours',
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_client ON questionnaire(client_id);

-- Authentification. Noms préfixés `app_` pour éviter toute ambiguïté avec
-- d'éventuels mots réservés SQL (`user` ne l'est pas dans SQLite, mais autant
-- ne pas en dépendre).
CREATE TABLE IF NOT EXISTS app_user (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    password_salt       TEXT NOT NULL,
    is_admin            INTEGER NOT NULL DEFAULT 0,
    active              INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    last_login_at       TEXT,
    totp_secret         TEXT,
    totp_pending_secret TEXT,
    totp_enabled        INTEGER NOT NULL DEFAULT 0,
    totp_last_counter   INTEGER,
    mfa_enabled_at      TEXT
);

CREATE TABLE IF NOT EXISTS app_session (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    mfa_pending INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_session_user ON app_session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expiry ON app_session(expires_at);

-- Codes de récupération à usage unique, seule porte de sortie si le second
-- facteur est perdu. Stockés hachés : ils ne sont affichés qu'une seule fois,
-- à la génération.
CREATE TABLE IF NOT EXISTS app_recovery_code (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON app_recovery_code(user_id);

-- Journal d'audit. Table en ajout seul du point de vue de l'application :
-- aucun endpoint ne permet de modifier ou supprimer une ligne individuelle,
-- seule la purge de rétention efface (et elle est elle-même journalisée).
-- Le nom de l'acteur est dénormalisé afin que la trace survive à la
-- suppression du compte — un journal qui perd ses acteurs ne prouve rien.
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    event        TEXT NOT NULL,
    outcome      TEXT NOT NULL DEFAULT 'success',
    actor_id     INTEGER,
    actor_name   TEXT,
    ip           TEXT,
    user_agent   TEXT,
    target_type  TEXT,
    target_id    INTEGER,
    target_label TEXT,
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

CREATE TABLE IF NOT EXISTS qq_question (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    questionnaire_id INTEGER NOT NULL REFERENCES questionnaire(id) ON DELETE CASCADE,
    idx              INTEGER NOT NULL,
    ref              TEXT,
    section          TEXT,
    text             TEXT NOT NULL,
    suggested_answer TEXT,
    final_answer     TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    confidence       REAL NOT NULL DEFAULT 0,
    matched_kind     TEXT,
    matched_id       INTEGER,
    candidates_json  TEXT,
    locator_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_qq_questionnaire ON qq_question(questionnaire_id);
"""


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """Une connexion par requête : simple et sûr vis-à-vis du threading FastAPI."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Colonnes ajoutées après la première mise en service. `CREATE TABLE IF NOT
# EXISTS` ne touche pas une table déjà créée : ces colonnes doivent donc être
# ajoutées explicitement sur les bases existantes.
MIGRATIONS: dict[str, dict[str, str]] = {
    "app_user": {
        "totp_secret": "TEXT",
        "totp_pending_secret": "TEXT",
        "totp_enabled": "INTEGER NOT NULL DEFAULT 0",
        "totp_last_counter": "INTEGER",
        "mfa_enabled_at": "TEXT",
    },
    "app_session": {
        # Session créée après le mot de passe mais avant le second facteur :
        # elle n'autorise que la vérification MFA, rien d'autre.
        "mfa_pending": "INTEGER NOT NULL DEFAULT 0",
    },
}


# Colonnes retirées après coup. Les laisser en place serait moins risqué, mais
# une colonne morte finit toujours par semer le doute : on la supprime.
REMOVED_COLUMNS: dict[str, tuple[str, ...]] = {
    "client": ("sector",),
}


def _apply_migrations(conn: sqlite3.Connection) -> None:
    for table, columns in MIGRATIONS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if not existing:
            continue  # table absente : le schéma la créera avec ses colonnes
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

    for table, names in REMOVED_COLUMNS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name in names:
            if name in existing:
                conn.execute(f"ALTER TABLE {table} DROP COLUMN {name}")


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        _apply_migrations(conn)
        conn.commit()
    finally:
        conn.close()


def rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict[str, Any] | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None


def scalar(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> Any:
    r = conn.execute(sql, params).fetchone()
    return r[0] if r else None
