"""Regression tests for the supported SQLite schema migration path."""

import sqlite3

import migrate_db
from models import db
from services.db.schema_service import validate_sqlite_database


def _create_legacy_database(path):
    conn = sqlite3.connect(path)
    try:
        conn.executescript("""
            CREATE TABLE "user" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username VARCHAR(64) UNIQUE,
                password_hash VARCHAR(128),
                is_admin BOOLEAN,
                is_operator BOOLEAN,
                must_change_password BOOLEAN NOT NULL DEFAULT 0,
                created_at TIMESTAMP,
                last_map_id INTEGER
            );
            CREATE TABLE map (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(128),
                owner_id INTEGER,
                created_at TIMESTAMP,
                background_image VARCHAR(256),
                is_locked BOOLEAN NOT NULL DEFAULT 0
            );
            CREATE TABLE device_type (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(64),
                icon_filename VARCHAR(256),
                width INTEGER,
                height INTEGER
            );
            CREATE TABLE "group" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(64) NOT NULL,
                color VARCHAR(7),
                font_size INTEGER,
                map_id INTEGER
            );
            CREATE TABLE device (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER,
                type_id INTEGER,
                name VARCHAR(64),
                ip_address VARCHAR(45),
                font_size INTEGER,
                pos_x FLOAT,
                pos_y FLOAT,
                status BOOLEAN,
                last_check TIMESTAMP,
                group_id INTEGER,
                monitoring_enabled BOOLEAN
            );
            CREATE TABLE device_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER,
                old_status BOOLEAN,
                new_status BOOLEAN,
                timestamp TIMESTAMP
            );
            CREATE TABLE link (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER,
                source_device_id INTEGER,
                target_device_id INTEGER,
                source_interface VARCHAR(32),
                target_interface VARCHAR(32),
                link_type VARCHAR(20),
                line_color VARCHAR(7),
                line_width INTEGER,
                line_style VARCHAR(10),
                font_size INTEGER
            );
            CREATE TABLE settings (
                key VARCHAR(64) PRIMARY KEY,
                value VARCHAR(256)
            );
            CREATE TABLE user_map_settings (
                user_id INTEGER NOT NULL,
                map_id INTEGER NOT NULL,
                pan_x FLOAT,
                pan_y FLOAT,
                zoom FLOAT,
                PRIMARY KEY (user_id, map_id)
            );
            CREATE TABLE map_shape (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL,
                shape_type VARCHAR(20) NOT NULL,
                x FLOAT NOT NULL,
                y FLOAT NOT NULL,
                width FLOAT NOT NULL,
                height FLOAT NOT NULL,
                font_size INTEGER,
                color VARCHAR(7) NOT NULL,
                opacity FLOAT NOT NULL,
                description VARCHAR(255)
            );
            CREATE TABLE audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username VARCHAR(64),
                action VARCHAR(50) NOT NULL,
                target_type VARCHAR(30),
                target_id INTEGER,
                target_name VARCHAR(128),
                old_values JSON,
                new_values JSON,
                ip_address VARCHAR(45),
                user_agent VARCHAR(256),
                timestamp TIMESTAMP
            );
            INSERT INTO "user" (username, is_admin, is_operator, must_change_password)
            VALUES ('admin', 1, 0, 0);
            INSERT INTO map (name, owner_id) VALUES ('Legacy map', 1);
            INSERT INTO device_type (name, icon_filename) VALUES ('Router', '');
            INSERT INTO "group" (name, map_id) VALUES ('Legacy group', 1);
            INSERT INTO device (
                map_id, type_id, name, ip_address, status, group_id, monitoring_enabled
            ) VALUES (1, 1, 'Legacy device', '192.0.2.10', 1, 1, 1);
            INSERT INTO device_history (device_id, old_status, new_status)
            VALUES (1, 0, 1);
            """)
        conn.commit()
    finally:
        conn.close()


def test_legacy_sqlite_upgrade_covers_all_known_schema_gaps(tmp_path, monkeypatch):
    db_path = tmp_path / "webnetmap.db"
    _create_legacy_database(db_path)

    monkeypatch.setattr(
        migrate_db.Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{db_path}"
    )
    monkeypatch.setattr(migrate_db.Config, "BASE_DIR", str(tmp_path))

    migrate_db.run_migration()

    result = validate_sqlite_database(str(db_path), db.metadata)
    assert result.valid, result.message

    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT ip_address FROM device_ips").fetchone() == (
            "192.0.2.10",
        )
        assert conn.execute("SELECT status FROM device WHERE id = 1").fetchone() == (
            "up",
        )
        assert conn.execute(
            "SELECT old_status, new_status FROM device_history WHERE id = 1"
        ).fetchone() == ("down", "up")
        assert conn.execute('SELECT locale FROM "user" WHERE id = 1').fetchone() == (
            None,
        )
        assert conn.execute(
            'SELECT parent_group_id FROM "group" WHERE id = 1'
        ).fetchone() == (None,)

        expected_tables = {
            "map_folder",
            "folder_permission",
            "map_permission",
            "quality_profile",
            "device_quality_history",
            "device_ips",
        }
        actual_tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert expected_tables <= actual_tables

        map_columns = {row[1] for row in conn.execute('PRAGMA table_info("map")')}
        assert {"folder_id", "position"} <= map_columns
    finally:
        conn.close()


def test_sqlite_migration_is_idempotent(tmp_path, monkeypatch):
    db_path = tmp_path / "webnetmap.db"
    _create_legacy_database(db_path)

    monkeypatch.setattr(
        migrate_db.Config, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{db_path}"
    )
    monkeypatch.setattr(migrate_db.Config, "BASE_DIR", str(tmp_path))

    migrate_db.run_migration()
    first = db_path.read_bytes()
    migrate_db.run_migration()
    second = db_path.read_bytes()

    assert first == second
