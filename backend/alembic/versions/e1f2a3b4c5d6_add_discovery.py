"""Add discovery tables (docs/discovery.md — composable interests → events).

Revision ID: e1f2a3b4c5d6
Revises: d6e7f8a9b0c1
Create Date: 2026-06-07
"""
from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "place",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False, server_default="city"),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("country", sa.String(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("radius_km", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("precision", sa.String(), nullable=False, server_default="city"),
        sa.Column("is_home", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "interest_facet",
        sa.Column("interest_id", sa.String(), sa.ForeignKey("interest.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("facet_type", sa.String(), nullable=False),
        sa.Column("entity_ref", sa.JSON(), nullable=False),
        sa.Column("location_mode", sa.String(), nullable=False, server_default="place"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "discovery_feed",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("place_id", sa.String(), sa.ForeignKey("place.id", ondelete="SET NULL"), nullable=True),
        sa.Column("categories", sa.JSON(), nullable=False),
        sa.Column("subject_interest_ids", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("min_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("create_events", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("interest_id", sa.String(), sa.ForeignKey("interest.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_discovery_feed_place_id", "discovery_feed", ["place_id"])


def downgrade() -> None:
    op.drop_index("ix_discovery_feed_place_id", table_name="discovery_feed")
    op.drop_table("discovery_feed")
    op.drop_table("interest_facet")
    op.drop_table("place")
