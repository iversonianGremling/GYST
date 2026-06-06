"""Add sync_conflict table (Part I, Phase 4 — in-app resolver).

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_conflict",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("note_id", sa.String(), sa.ForeignKey("note.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ours_title", sa.String(), nullable=False, server_default=""),
        sa.Column("ours_body", sa.Text(), nullable=False, server_default=""),
        sa.Column("theirs_title", sa.String(), nullable=False, server_default=""),
        sa.Column("theirs_body", sa.Text(), nullable=False, server_default=""),
        sa.Column("theirs_hash", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),  # open|resolved
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sync_conflict")
