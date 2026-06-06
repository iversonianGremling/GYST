"""Add reference table (Part II — research-project plugin).

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reference",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("interest_id", sa.String(), sa.ForeignKey("interest.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="article"),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("authors", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("doi", sa.String(), nullable=True),
        sa.Column("url", sa.String(), nullable=True),
        sa.Column("bibtex", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source_app", sa.String(), nullable=True),
        sa.Column("external_id", sa.String(), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("reference")
