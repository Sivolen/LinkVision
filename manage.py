#!/usr/bin/env python3
"""Локальные административные команды LinkVision."""

import argparse
import getpass
import sys

from app import create_app
from extensions import db
from models import User
from services.security_service import validate_password_full
from utils.logger import admin_logger


def _prompt_password(username):
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print("Для ввода пароля нужен интерактивный терминал.", file=sys.stderr)
        return None

    password = getpass.getpass("Новый пароль: ")
    confirmation = getpass.getpass("Повторите пароль: ")
    if password != confirmation:
        print("Пароли не совпадают.", file=sys.stderr)
        return None

    is_valid, error = validate_password_full(password, username)
    if not is_valid:
        print(f"Недопустимый пароль: {error}.", file=sys.stderr)
        return None
    return password


def _create_admin(username):
    if User.query.filter_by(is_admin=True).first():
        print("Администратор уже настроен; изменений нет.")
        return 0
    if not 3 <= len(username) <= 64:
        print("Имя администратора должно содержать от 3 до 64 символов.", file=sys.stderr)
        return 2
    if User.query.filter_by(username=username).first():
        print("Пользователь с таким именем уже существует.", file=sys.stderr)
        return 2

    password = _prompt_password(username)
    if password is None:
        return 2

    admin = User(username=username, is_admin=True)
    admin.set_password(password)
    admin.must_change_password = True
    db.session.add(admin)
    db.session.commit()
    admin_logger.info("Administrator account created through local management command")
    print(f"Администратор {username} создан. Пароль не записывался в журналы.")
    return 0


def _reset_admin_password(username):
    admin = User.query.filter_by(username=username, is_admin=True).first()
    if not admin:
        print("Администратор с таким именем не найден.", file=sys.stderr)
        return 2

    password = _prompt_password(username)
    if password is None:
        return 2

    admin.set_password(password)
    admin.must_change_password = True
    db.session.commit()
    admin_logger.info("Administrator password reset through local management command")
    print(f"Пароль администратора {username} обновлён.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Административные команды LinkVision")
    commands = parser.add_subparsers(dest="command", required=True)

    create_parser = commands.add_parser(
        "create-admin", help="создать первого администратора"
    )
    create_parser.add_argument("username", nargs="?", default="admin")

    commands.add_parser("migrate", help="применить и проверить миграции SQLite")

    reset_parser = commands.add_parser(
        "reset-admin-password", help="сменить пароль существующего администратора"
    )
    reset_parser.add_argument("username")

    args = parser.parse_args(argv)
    if args.command == "migrate":
        from migrate_db import run_full_migration

        run_full_migration()
        return 0

    app = create_app(
        start_background_services=False,
        allow_unconfigured_admin=True,
    )
    with app.app_context():
        if args.command == "create-admin":
            return _create_admin(args.username)
        return _reset_admin_password(args.username)


if __name__ == "__main__":
    raise SystemExit(main())
