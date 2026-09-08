#!/usr/bin/env python3
"""Compatibility entrypoint; migration logic lives in migrate_db.py."""

from config import Config
from migrate_db import _migrate_quality
from sqlalchemy import create_engine


def main() -> None:
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    with engine.begin() as conn:
        _migrate_quality(conn)
    print("Quality monitoring migration completed successfully.")


if __name__ == "__main__":
    main()
