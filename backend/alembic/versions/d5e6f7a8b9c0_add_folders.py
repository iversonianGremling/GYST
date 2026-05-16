"""Add folder model + folder_id on interest/note + note aesthetic fields

Revision ID: d5e6f7a8b9c0
Revises: b3c9f1a2d8e0
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = "d5e6f7a8b9c0"
down_revision = "b3c9f1a2d8e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "folder",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("parent_id", sa.String(), sa.ForeignKey("folder.id", ondelete="CASCADE"), nullable=True),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("interest", sa.Column("folder_id", sa.String(), sa.ForeignKey("folder.id", ondelete="SET NULL"), nullable=True))
    op.add_column("note", sa.Column("folder_id", sa.String(), sa.ForeignKey("folder.id", ondelete="SET NULL"), nullable=True))
    op.add_column("note", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("note", sa.Column("cover_path", sa.String(), nullable=True))
    op.add_column("note", sa.Column("cover_settings", sa.JSON(), nullable=True))
    op.add_column("note", sa.Column("pinned", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("note", "pinned")
    op.drop_column("note", "cover_settings")
    op.drop_column("note", "cover_path")
    op.drop_column("note", "description")
    op.drop_column("note", "folder_id")
    op.drop_column("interest", "folder_id")
    op.drop_table("folder")
