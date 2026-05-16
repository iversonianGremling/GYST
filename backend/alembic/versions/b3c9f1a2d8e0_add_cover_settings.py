"""add cover_settings to interest

Revision ID: b3c9f1a2d8e0
Revises: 7de7681f46f8
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = "b3c9f1a2d8e0"
down_revision = "7de7681f46f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("interest", sa.Column("cover_settings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("interest", "cover_settings")
