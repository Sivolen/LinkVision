"""add audit and permissions

Revision ID: e82b4562e16c
Revises: 1cf71a0bd69a
Create Date: 2026-06-16

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e82b4562e16c'
down_revision = '1cf71a0bd69a'
branch_labels = None
depends_on = None


def upgrade():
    # Создаём таблицу audit_log
    op.create_table(
        'audit_log',
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
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_action'), 'audit_log', ['action'], unique=False)
    op.create_index(op.f('ix_audit_log_target_id'), 'audit_log', ['target_id'], unique=False)
    op.create_index(op.f('ix_audit_log_target_type'), 'audit_log', ['target_type'], unique=False)
    op.create_index(op.f('ix_audit_log_timestamp'), 'audit_log', ['timestamp'], unique=False)
    op.create_index(op.f('ix_audit_log_user_id'), 'audit_log', ['user_id'], unique=False)
    op.create_index('idx_audit_action', 'audit_log', ['action'], unique=False)
    op.create_index('idx_audit_target', 'audit_log', ['target_type', 'target_id'], unique=False)
    op.create_index('idx_audit_user_timestamp', 'audit_log', ['user_id', 'timestamp'], unique=False)

    # Создаём таблицу map_permission
    op.create_table(
        'map_permission',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('map_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('role', sa.String(length=20), nullable=True),
        sa.ForeignKeyConstraint(['map_id'], ['map.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('(user_id IS NOT NULL) OR (role IS NOT NULL)', name='check_user_or_role'),
        sa.UniqueConstraint('map_id', 'user_id', name='uq_map_user'),
        sa.UniqueConstraint('map_id', 'role', name='uq_map_role')
    )
    op.create_index(op.f('ix_map_permission_map_id'), 'map_permission', ['map_id'], unique=False)
    op.create_index(op.f('ix_map_permission_user_id'), 'map_permission', ['user_id'], unique=False)

    # Добавляем is_locked к map
    op.add_column('map', sa.Column('is_locked', sa.Boolean(), nullable=False, server_default='0'))

    # Добавляем foreign key к device_ips
    op.create_foreign_key('fk_device_ips_device_id', 'device_ips', 'device', ['device_id'], ['id'], ondelete='CASCADE')
    
    # Исправляем created_at в device_ips (TIMESTAMP -> DateTime)
    # SQLite не поддерживает изменение типа напрямую, поэтому создаём новую колонку
    op.add_column('device_ips', sa.Column('created_at_new', sa.DateTime(), nullable=True))
    op.execute("UPDATE device_ips SET created_at_new = created_at")
    op.drop_column('device_ips', 'created_at')
    op.rename_column('device_ips', 'created_at_new', 'created_at')
    op.alter_column('device_ips', 'created_at', nullable=False)

    # Добавляем индексы для link
    op.create_index('idx_link_map_id', 'link', ['map_id'], unique=False)


def downgrade():
    op.drop_index('idx_link_map_id', table_name='link')
    op.alter_column('device_ips', 'created_at', nullable=True)
    op.rename_column('device_ips', 'created_at', 'created_at_old')
    op.drop_column('device_ips', 'created_at')
    op.drop_constraint('fk_device_ips_device_id', 'device_ips', type_='foreignkey')
    op.drop_column('map', 'is_locked')
    op.drop_index(op.f('ix_map_permission_user_id'), table_name='map_permission')
    op.drop_index(op.f('ix_map_permission_map_id'), table_name='map_permission')
    op.drop_table('map_permission')
    op.drop_index(op.f('ix_audit_user_timestamp'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_target'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_action'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_timestamp'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_user_id'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_target_type'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_target_id'), table_name='audit_log')
    op.drop_index(op.f('ix_audit_log_action'), table_name='audit_log')
    op.drop_table('audit_log')
