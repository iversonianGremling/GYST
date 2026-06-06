from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gyst.auth import require_auth
from gyst.core.models import PluginSetting
from gyst.db import get_session
from gyst.plugins import loader

router = APIRouter(prefix="/plugins", tags=["plugins"])


@router.get("")
async def list_plugins(_uid: int = Depends(require_auth)):
    return [
        {
            "id": p.id,
            "name": p.name,
            "version": p.manifest["version"],
            "hooks": p.hooks,
            "ui_slots": p.ui_slots,
            "project_types": p.project_types,
            "widget": p.widget,
        }
        for p in loader.get_all()
    ]


@router.get("/{plugin_id}/settings")
async def get_settings(
    plugin_id: str,
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    result = await session.execute(select(PluginSetting).where(PluginSetting.plugin_id == plugin_id))
    return {row.key: row.value for row in result.scalars()}


@router.put("/{plugin_id}/settings")
async def put_settings(
    plugin_id: str,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
    _uid: int = Depends(require_auth),
):
    for key, value in body.items():
        result = await session.execute(
            select(PluginSetting).where(PluginSetting.plugin_id == plugin_id, PluginSetting.key == key)
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.value = value
        else:
            session.add(PluginSetting(plugin_id=plugin_id, key=key, value=value))
    await session.commit()
    return {"ok": True}
