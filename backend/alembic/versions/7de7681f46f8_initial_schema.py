"""initial schema

Revision ID: 7de7681f46f8
Revises:
Create Date: 2026-05-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '7de7681f46f8'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user',
        sa.Column('id', sa.Integer(), primary_key=True, default=1),
        sa.Column('password_hash', sa.String(), nullable=False, server_default=''),
    )
    op.create_table('tag',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(), nullable=False, unique=True),
    )
    op.create_table('interest',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False, unique=True),
        sa.Column('description', sa.Text()),
        sa.Column('cover_path', sa.String()),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('project',
        sa.Column('interest_id', sa.String(), sa.ForeignKey('interest.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('type', sa.String(), nullable=False, server_default='generic'),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('settings', sa.JSON(), nullable=False, server_default='{}'),
    )
    op.create_table('note',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('interest_id', sa.String(), sa.ForeignKey('interest.id', ondelete='SET NULL')),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('body_md', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('link',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('src_type', sa.String(), nullable=False),
        sa.Column('src_id', sa.String(), nullable=False),
        sa.Column('dst_type', sa.String(), nullable=False),
        sa.Column('dst_id', sa.String(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False, server_default='wikilink'),
    )
    op.create_table('tagging',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tag_id', sa.Integer(), sa.ForeignKey('tag.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_type', sa.String(), nullable=False),
        sa.Column('target_id', sa.String(), nullable=False),
    )
    op.create_table('event',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('interest_id', sa.String(), sa.ForeignKey('interest.id', ondelete='SET NULL')),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True)),
        sa.Column('all_day', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('rrule', sa.String()),
        sa.Column('body_md', sa.Text(), nullable=False, server_default=''),
        sa.Column('color', sa.String()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('media_asset',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('interest_id', sa.String(), sa.ForeignKey('interest.id', ondelete='SET NULL')),
        sa.Column('kind', sa.String(), nullable=False, server_default='file'),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('sha256', sa.String(), nullable=False),
        sa.Column('mime', sa.String(), nullable=False, server_default='application/octet-stream'),
        sa.Column('original_name', sa.String(), nullable=False, server_default=''),
        sa.Column('duration_s', sa.Float()),
        sa.Column('meta', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('rating',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('target_type', sa.String(), nullable=False),
        sa.Column('target_id', sa.String(), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('note', sa.Text()),
        sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('feed_item',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('interest_id', sa.String(), sa.ForeignKey('interest.id', ondelete='SET NULL')),
        sa.Column('source_plugin', sa.String(), nullable=False),
        sa.Column('external_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False, server_default=''),
        sa.Column('url', sa.String()),
        sa.Column('payload', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('seen_at', sa.DateTime(timezone=True)),
        sa.Column('score', sa.Float(), nullable=False, server_default='0'),
        sa.Column('score_breakdown', sa.JSON(), nullable=False, server_default='{}'),
    )
    op.create_table('telemetry_event',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('target_url', sa.String()),
        sa.Column('target_id', sa.String()),
        sa.Column('duration_s', sa.Float()),
        sa.Column('meta', sa.JSON(), nullable=False, server_default='{}'),
    )
    op.create_table('embedding',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('target_type', sa.String(), nullable=False),
        sa.Column('target_id', sa.String(), nullable=False),
        sa.Column('vec', sa.LargeBinary(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('plugin_setting',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('plugin_id', sa.String(), nullable=False),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('value', sa.JSON()),
    )

    # FTS5 virtual table for full-text search over notes
    op.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS note_fts
        USING fts5(title, body_md, content='note', content_rowid='rowid')
    """)

    # Triggers to keep FTS in sync with the note table
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS note_fts_insert
        AFTER INSERT ON note BEGIN
            INSERT INTO note_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
        END
    """)
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS note_fts_update
        AFTER UPDATE ON note BEGIN
            INSERT INTO note_fts(note_fts, rowid, title, body_md)
                VALUES('delete', old.rowid, old.title, old.body_md);
            INSERT INTO note_fts(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
        END
    """)
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS note_fts_delete
        AFTER DELETE ON note BEGIN
            INSERT INTO note_fts(note_fts, rowid, title, body_md)
                VALUES('delete', old.rowid, old.title, old.body_md);
        END
    """)

    # Useful indexes
    op.create_index('ix_interest_slug', 'interest', ['slug'])
    op.create_index('ix_note_interest', 'note', ['interest_id'])
    op.create_index('ix_note_slug', 'note', ['slug'])
    op.create_index('ix_link_src', 'link', ['src_type', 'src_id'])
    op.create_index('ix_link_dst', 'link', ['dst_type', 'dst_id'])
    op.create_index('ix_feed_item_score', 'feed_item', ['score'])
    op.create_index('ix_telemetry_ts', 'telemetry_event', ['ts'])
    op.create_index('ix_telemetry_source', 'telemetry_event', ['source'])
    op.create_index('ix_embedding_target', 'embedding', ['target_type', 'target_id'])


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS note_fts_delete")
    op.execute("DROP TRIGGER IF EXISTS note_fts_update")
    op.execute("DROP TRIGGER IF EXISTS note_fts_insert")
    op.execute("DROP TABLE IF EXISTS note_fts")

    for table in [
        'plugin_setting', 'embedding', 'telemetry_event', 'feed_item',
        'rating', 'media_asset', 'event', 'tagging', 'link', 'note',
        'project', 'interest', 'tag', 'user',
    ]:
        op.drop_table(table)
