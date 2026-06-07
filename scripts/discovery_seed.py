"""Idempotently seed the user's Places (docs/discovery.md §3.1).

Run once:  PYTHONPATH=backend ../.venv/bin/python scripts/discovery_seed.py
Home/focus = Galicia (region); Vigo + Santiago primary; Madrid/Barcelona/Bilbao
secondary. Safe to re-run — skips labels that already exist.
"""
import asyncio

from sqlalchemy import select

from gyst.core.models import Place
from gyst.db import SessionLocal

SEED = [
    # label, scope, city, region, country, lat, lon, radius_km, is_home
    ("Galicia", "region", None, "Galicia", "ES", 42.7556, -7.8662, 200, True),
    ("Vigo", "city", "Vigo", "Galicia", "ES", 42.2406, -8.7207, 40, False),
    ("Santiago de Compostela", "city", "Santiago de Compostela", "Galicia", "ES", 42.8782, -8.5448, 40, False),
    ("Bilbao", "city", "Bilbao", "País Vasco", "ES", 43.2630, -2.9350, 40, False),
    ("Madrid", "city", "Madrid", "Madrid", "ES", 40.4168, -3.7038, 40, False),
    ("Barcelona", "city", "Barcelona", "Cataluña", "ES", 41.3874, 2.1686, 40, False),
]


async def main() -> None:
    async with SessionLocal() as s:
        existing = {r for r in (await s.execute(select(Place.label))).scalars()}
        added = 0
        for label, scope, city, region, country, lat, lon, radius, is_home in SEED:
            if label in existing:
                continue
            s.add(Place(label=label, scope=scope, city=city, region=region,
                        country=country, lat=lat, lon=lon, radius_km=radius,
                        precision="city", is_home=is_home))
            added += 1
        await s.commit()
        print(f"seeded {added} place(s); {len(existing)} already present")


if __name__ == "__main__":
    asyncio.run(main())
