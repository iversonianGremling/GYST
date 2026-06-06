"""Add vault-sync columns: sync_enabled selection + note sync-state.

Revision ID: f1a2b3c4d5e6
Revises: d5e6f7a8b9c0
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a2b3c4d5e6"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-entity opt-in to the vault (docs/vault-sync.md §6)
    op.add_column("folder", sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("interest", sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default="0"))
    # Note sync-state (used now for materialization, by Phase 3/4 for round-trip)
    op.add_column("note", sa.Column("vault_path", sa.String(), nullable=True))
    op.add_column("note", sa.Column("last_synced_hash", sa.String(), nullable=True))
    op.add_column("note", sa.Column("last_synced_commit", sa.String(), nullable=True))
    op.add_column("note", sa.Column("sync_status", sa.String(), nullable=False, server_default="clean"))


def downgrade() -> None:
    op.drop_column("note", "sync_status")
    op.drop_column("note", "last_synced_commit")
    op.drop_column("note", "last_synced_hash")
    op.drop_column("note", "vault_path")
    op.drop_column("interest", "sync_enabled")
    op.drop_column("folder", "sync_enabled")
