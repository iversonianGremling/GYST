"""Add music_score table (Part III — music-project plugin, composition suite).

Revision ID: d6e7f8a9b0c1
Revises: c9d0e1f2a3b4
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa

revision = "d6e7f8a9b0c1"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "music_score",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("interest_id", sa.String(), sa.ForeignKey("interest.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False, server_default="Untitled"),
        sa.Column("kind", sa.String(), nullable=False, server_default="midi"),
        sa.Column("doc", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_music_score_interest_id", "music_score", ["interest_id"])


def downgrade() -> None:
    op.drop_index("ix_music_score_interest_id", table_name="music_score")
    op.drop_table("music_score")
