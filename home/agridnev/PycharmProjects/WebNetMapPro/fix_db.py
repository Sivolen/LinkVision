#!/usr/bin/env python3
"""
Скрипт для исправления миграций Alembic при проблемах с SQLite.

Проблема: Alembic генерирует batch_alter_table для SQLite, что вызывает ошибку:
"ValueError: Constraint must have a name"

Решение: Сбрасывает alembic_version и создаёт миграцию с нуля.

Использование:
    python fix_db.py

Требования:
    - Должен запускаться из корня проекта
    - Должен быть активирован venv
"""

import os
import sys
import sqlite3
import shutil
from pathlib import Path

# Настройки
DB_NAME = "webnetmap.db"
MIGRATIONS_DIR = "migrations/versions"
BACKUP_DIR = "migrations/backups"


def check_venv():
    """Проверка что venv активирован."""
    if not hasattr(sys, 'real_prefix') and not (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix):
        print("⚠️  Warning: virtualenv не активирован")
        print("   Активируйте: source venv/bin/activate")
        return False
    return True


def check_requirements():
    """Проверка что все необходимые пакеты установлены."""
    try:
        import flask_migrate
        import alembic
        import sqlalchemy
        print("✅ Все необходимые пакеты установлены")
        return True
    except ImportError as e:
        print(f"❌ Ошибка: {e}")
        print("   Установите: pip install flask-migrate alembic sqlalchemy")
        return False


def get_db_path():
    """Получение пути к БД."""
    db_path = Path(DB_NAME)
    if db_path.exists():
        return db_path
    print("⚠️  БД не найдена")
    return None


def backup_db(db_path):
    """Создание резервной копии БД."""
    backup_path = db_path.with_suffix('.db.backup')
    shutil.copy2(db_path, backup_path)
    print(f"✅ Создана резервная копия: {backup_path}")
    return backup_path


def reset_alembic_version(db_path):
    """Сброс alembic_version в БД."""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Проверяем существование таблицы
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")
        if not cursor.fetchone():
            print("✅ alembic_version не найдена (новая БД)")
            return True
        
        # Сбрасываем
        cursor.execute("DELETE FROM alembic_version")
        conn.commit()
        print("✅ alembic_version сброшен")
        return True
    except Exception as e:
        print(f"❌ Ошибка при сбросе alembic_version: {e}")
        return False
    finally:
        conn.close()


def reset_alembic_version_for_new_db(db_path):
    """Сброс alembic_version для новой БД (создаёт таблицу пустой)."""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Создаём пустую таблицу alembic_version
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS alembic_version (
                version_num VARCHAR(32) NOT NULL
            )
        """)
        conn.commit()
        print("✅ alembic_version создан (пустой)")
        return True
    except Exception as e:
        print(f"❌ Ошибка при создании alembic_version: {e}")
        return False
    finally:
        conn.close()


def create_migration_file():
    """Создание файла миграции с нуля."""
    migrations_path = Path(MIGRATIONS_DIR)
    migrations_path.mkdir(parents=True, exist_ok=True)
    
    migration_file = migrations_path / "0001_initial.py"
    
    # Создаём директорию backup
    backup_dir = Path(BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    # Перемещаем старые миграции в backup
    old_files = list(migrations_path.glob("*.py"))
    if old_files:
        print(f"📦 Перемещение {len(old_files)} старых миграций в {backup_dir}/")
        for old_file in old_files:
            shutil.move(str(old_file), str(backup_dir / old_file.name))
        print(f"✅ Старые миграции перемещены в {backup_dir}/")
    
    migration_content = '''"""initial migration

Revision ID: 0001_initial
Revises: 
Create Date: 2026-06-16

"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # user
    op.create_table('user',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(length=64), nullable=False),
        sa.Column('email', sa.String(length=120), nullable=True),
        sa.Column('password_hash', sa.String(length=256), nullable=True),
        sa.Column('is_admin', sa.Boolean(), nullable=True),
        sa.Column('is_operator', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('username'))
    op.create_index(op.f('ix_user_username'), 'user', ['username'], unique=True)

    # device_type
    op.create_table('device_type',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('icon_filename', sa.String(length=128), nullable=True),
        sa.PrimaryKeyConstraint('id'))

    # map
    op.create_table('map',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('background_image', sa.String(length=256), nullable=True),
        sa.Column('is_locked', sa.Boolean(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['owner_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'))

    # device
    op.create_table('device',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=True),
        sa.Column('type_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=128), nullable=True),
        sa.Column('pos_x', sa.Float(), nullable=True),
        sa.Column('pos_y', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('monitoring_enabled', sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.ForeignKeyConstraint(['type_id'], ['device_type.id']),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_device_map_id'), 'device', ['map_id'])
    op.create_index(op.f('ix_device_type_id'), 'device', ['type_id'])

    # device_ips
    op.create_table('device_ips',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['device_id'], ['device.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))

    # link
    op.create_table('link',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=True),
        sa.Column('source_device_id', sa.Integer(), nullable=True),
        sa.Column('target_device_id', sa.Integer(), nullable=True),
        sa.Column('source_interface', sa.String(length=32), nullable=True),
        sa.Column('target_interface', sa.String(length=32), nullable=True),
        sa.Column('link_type', sa.String(length=20), nullable=True),
        sa.Column('line_color', sa.String(length=7), nullable=True),
        sa.Column('line_width', sa.Integer(), nullable=True),
        sa.Column('line_style', sa.String(length=10), nullable=True),
        sa.Column('font_size', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.ForeignKeyConstraint(['source_device_id'], ['device.id']),
        sa.ForeignKeyConstraint(['target_device_id'], ['device.id']),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_link_map_id'), 'link', ['map_id'])

    # group
    op.create_table('group',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=True),
        sa.Column('font_size', sa.Integer(), nullable=True),
        sa.Column('map_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.PrimaryKeyConstraint('id'))

    # settings
    op.create_table('settings',
        sa.Column('key', sa.String(length=64), primary_key=True),
        sa.Column('value', sa.String(length=256), nullable=True))

    # user_map_settings
    op.create_table('user_map_settings',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=False),
        sa.Column('pan_x', sa.Float(), nullable=True),
        sa.Column('pan_y', sa.Float(), nullable=True),
        sa.Column('zoom', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('user_id', 'map_id'))

    # map_shape
    op.create_table('map_shape',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=False),
        sa.Column('shape_type', sa.String(length=20), nullable=False),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('width', sa.Float(), nullable=False),
        sa.Column('height', sa.Float(), nullable=False),
        sa.Column('font_size', sa.Integer(), nullable=True),
        sa.Column('color', sa.String(length=7), nullable=False),
        sa.Column('opacity', sa.Float(), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_map_shape_map_id'), 'map_shape', ['map_id'])

    # device_history
    op.create_table('device_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=True),
        sa.Column('old_status', sa.String(length=10), nullable=True),
        sa.Column('new_status', sa.String(length=10), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['device_id'], ['device.id']),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('idx_device_history_device_id_timestamp', 'device_history', ['device_id', 'timestamp'])

    # audit_log
    op.create_table('audit_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('username', sa.String(length=64), nullable=True),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('target_type', sa.String(length=30), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('target_name', sa.String(length=128), nullable=True),
        sa.Column('old_values', sa.JSON(), nullable=True),
        sa.Column('new_values', sa.JSON(), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=256), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'))
    op.create_index('ix_audit_log_action', 'audit_log', ['action'])
    op.create_index('ix_audit_log_target_id', 'audit_log', ['target_id'])
    op.create_index('ix_audit_log_target_type', 'audit_log', ['target_type'])
    op.create_index('ix_audit_log_timestamp', 'audit_log', ['timestamp'])
    op.create_index('ix_audit_log_user_id', 'audit_log', ['user_id'])
    op.create_index('idx_audit_action', 'audit_log', ['action'])
    op.create_index('idx_audit_target', 'audit_log', ['target_type', 'target_id'])
    op.create_index('idx_audit_user_timestamp', 'audit_log', ['user_id', 'timestamp'])

    # map_permission
    op.create_table('map_permission',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('role', sa.String(length=20), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id']),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('(user_id IS NOT NULL) OR (role IS NOT NULL)', name='check_user_or_role'),
        sa.UniqueConstraint('map_id', 'user_id', name='uq_map_user'),
        sa.UniqueConstraint('map_id', 'role', name='uq_map_role'))
    op.create_index('ix_map_permission_map_id', 'map_permission', ['map_id'])
    op.create_index('ix_map_permission_user_id', 'map_permission', ['user_id'])

def downgrade():
    op.drop_table('map_permission')
    op.drop_table('audit_log')
    op.drop_table('device_history')
    op.drop_table('map_shape')
    op.drop_table('user_map_settings')
    op.drop_table('settings')
    op.drop_table('group')
    op.drop_table('link')
    op.drop_table('device_ips')
    op.drop_table('device')
    op.drop_table('map')
    op.drop_table('device_type')
    op.drop_table('user')
'''
    
    migration_file.write_text(migration_content)
    print(f"✅ Создана миграция: {migration_file}")
    return migration_file


def run_flask_upgrade():
    """Запуск flask db upgrade."""
    import subprocess
    
    print("\n🚀 Запуск flask db upgrade...")
    result = subprocess.run(
        ["flask", "db", "upgrade"],
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ Миграция применена успешно!")
        return True
    else:
        print("❌ Ошибка при применении миграции:")
        print(result.stderr)
        return False


def main():
    """Главная функция."""
    print("=" * 60)
    print("🔧 LinkVision - Fix DB Script")
    print("=" * 60)
    print()
    
    # Проверки
    if not check_venv():
        print("\n❌ Запуск отменён")
        return 1
    
    if not check_requirements():
        print("\n❌ Запуск отменён")
        return 1
    
    # Проверка БД
    db_path = get_db_path()
    if not db_path:
        print("\n⚠️  БД не найдена, будет создана новая")
    
    # Резервное копирование
    if db_path:
        backup_db(db_path)
    
    # Сброс alembic_version
    if db_path:
        reset_alembic_version(db_path)
    else:
        print("⚠️  БД не найдена, alembic_version будет создан автоматически")
    
    # Создание миграции
    create_migration_file()
    
    # Применение
    success = run_flask_upgrade()
    
    if success:
        print("\n" + "=" * 60)
        print("✅ Готово! Миграция применена успешно!")
        print("=" * 60)
        return 0
    else:
        print("\n" + "=" * 60)
        print("❌ Ошибка! Проверьте логи выше")
        print("=" * 60)
        return 1


if __name__ == "__main__":
    sys.exit(main())
