#!/usr/bin/env python
"""Run a full vault export against the live DB (read-only on the DB).

    cd /opt/gyst && PYTHONPATH=backend .venv/bin/python scripts/vault_export.py

Safe & reversible: only writes under data/vault/. Remove that dir to undo.
"""
from __future__ import annotations

import asyncio
import json


async def _main() -> None:
    from gyst.db import SessionLocal
    from gyst.sync.export import export_all

    async with SessionLocal() as session:
        summary = await export_all(session)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(_main())
