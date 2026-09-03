"""Database schema validation and lightweight version marker support.

The application does not use a checked-in Alembic migration chain yet, so a
backup cannot be safely upgraded just by opening it. This module provides a
single, conservative compatibility check used by restore and startup code.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Iterable, Mapping


SCHEMA_TABLE = "linkvision_schema"
SCHEMA_KEY = "schema_version"


@dataclass(frozen=True)
class SchemaValidationResult:
    valid: bool
    message: str | None = None
    missing_tables: tuple[str, ...] = ()
    missing_columns: tuple[str, ...] = ()
    version: str | None = None


def _sqlite_type_affinity(declared_type: str | None) -> str:
    """Return SQLite's broad type affinity for a declared column type."""
    value = (declared_type or "").upper()
    if "INT" in value:
        return "INTEGER"
    if any(token in value for token in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if "BLOB" in value or not value:
        return "BLOB"
    if any(token in value for token in ("REAL", "FLOA", "DOUB")):
        return "REAL"
    return "NUMERIC"


def _metadata_schema(metadata) -> Mapping[str, Mapping[str, object]]:
    result = {}
    for table in metadata.sorted_tables:
        result[table.name] = {
            column.name: column
            for column in table.columns
        }
    return result


def read_schema_version(conn: sqlite3.Connection) -> str | None:
    """Read the optional LinkVision schema marker from a SQLite database."""
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (SCHEMA_TABLE,),
    ).fetchone()
    if not exists:
        return None

    row = conn.execute(
        f'SELECT value FROM "{SCHEMA_TABLE}" WHERE key = ?',
        (SCHEMA_KEY,),
    ).fetchone()
    return str(row[0]) if row and row[0] is not None else None


def write_schema_version(conn: sqlite3.Connection, version: str) -> None:
    """Create/update the optional schema marker table."""
    conn.execute(
        f'''
        CREATE TABLE IF NOT EXISTS "{SCHEMA_TABLE}" (
            key VARCHAR(64) PRIMARY KEY,
            value VARCHAR(64) NOT NULL
        )
        '''
    )
    conn.execute(
        f'''
        INSERT INTO "{SCHEMA_TABLE}" (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        ''',
        (SCHEMA_KEY, str(version)),
    )


def validate_sqlite_database(
    path: str,
    metadata,
    expected_version: str | None = None,
) -> SchemaValidationResult:
    """Validate a SQLite file without modifying it.

    Extra tables/columns are allowed. Missing ORM tables/columns are not.
    If a LinkVision schema marker exists, its version must match the expected
    application version. Marker-less legacy databases are accepted when their
    actual structure is compatible; they will receive a marker on next startup.
    """
    try:
        conn = sqlite3.connect(path)
    except sqlite3.DatabaseError as exc:
        return SchemaValidationResult(False, f"SQLite database cannot be opened: {exc}")

    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()
        if not integrity or str(integrity[0]).lower() != "ok":
            return SchemaValidationResult(
                False,
                "Файл базы данных повреждён или не является корректной SQLite-базой.",
            )

        schema = _metadata_schema(metadata)
        existing_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        missing_tables = tuple(sorted(set(schema) - existing_tables))
        if missing_tables:
            return SchemaValidationResult(
                False,
                "Отсутствуют обязательные таблицы: " + ", ".join(missing_tables),
                missing_tables=missing_tables,
            )

        missing_columns: list[str] = []
        type_errors: list[str] = []
        for table_name, columns in schema.items():
            actual = {
                row[1]: row
                for row in conn.execute(f'PRAGMA table_info("{table_name}")')
            }
            for name, model_column in columns.items():
                if name not in actual:
                    missing_columns.append(f"{table_name}.{name}")
                    continue
                # Compare only broad SQLite affinity. This catches a genuinely
                # incompatible schema without rejecting harmless VARCHAR length
                # differences between SQLite/SQLAlchemy versions.
                model_type = _sqlite_type_affinity(getattr(model_column.type, "compile", lambda **_: str(model_column.type))())
                db_type = _sqlite_type_affinity(actual[name][2])
                if model_type != db_type:
                    type_errors.append(f"{table_name}.{name} ({db_type}, требуется {model_type})")

        if missing_columns:
            return SchemaValidationResult(
                False,
                "Отсутствуют обязательные поля: " + "; ".join(missing_columns),
                missing_columns=tuple(missing_columns),
            )

        version = read_schema_version(conn)
        if expected_version and version and version != expected_version:
            return SchemaValidationResult(
                False,
                f"Версия схемы базы данных {version} несовместима с текущей версией {expected_version}.",
                version=version,
            )

        if type_errors:
            return SchemaValidationResult(
                False,
                "Несовместимые типы полей: " + "; ".join(type_errors),
                version=version,
            )

        return SchemaValidationResult(True, version=version)
    except sqlite3.DatabaseError as exc:
        return SchemaValidationResult(False, f"Не удалось проверить структуру базы данных: {exc}")
    finally:
        conn.close()



def sqlite_database_is_empty(path: str) -> bool:
    """Return True when the SQLite file contains no application tables."""
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0] == 0
    finally:
        conn.close()


def mark_sqlite_schema(path: str, version: str) -> None:
    """Write the current schema marker after a successful compatibility check."""
    conn = sqlite3.connect(path)
    try:
        write_schema_version(conn, version)
        conn.commit()
    finally:
        conn.close()
