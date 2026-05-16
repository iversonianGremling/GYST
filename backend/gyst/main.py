from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from gyst.config import settings
from gyst.db import engine, Base
from gyst.plugins import loader as plugin_loader
from gyst import scheduler

log = logging.getLogger("gyst")
logging.basicConfig(level=logging.DEBUG if settings.server.debug else logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    plugin_loader.discover()
    scheduler.start()

    yield

    scheduler.stop()
    await engine.dispose()


app = FastAPI(
    title="GYST",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- routers ---
from gyst.api.v1 import auth as auth_router
from gyst.api.v1 import interests as interests_router
from gyst.api.v1 import projects as projects_router
from gyst.api.v1 import notes as notes_router
from gyst.api.v1 import calendar as calendar_router
from gyst.api.v1 import media as media_router
from gyst.api.v1 import feed as feed_router
from gyst.api.v1 import telemetry as telemetry_router
from gyst.api.v1 import search as search_router
from gyst.api.v1 import plugins as plugins_router
from gyst.api.v1 import tags as tags_router

API = "/api/v1"
app.include_router(auth_router.router,      prefix=API)
app.include_router(interests_router.router, prefix=API)
app.include_router(projects_router.router,  prefix=API)
app.include_router(notes_router.router,     prefix=API)
app.include_router(calendar_router.router,  prefix=API)
app.include_router(media_router.router,     prefix=API)
app.include_router(feed_router.router,      prefix=API)
app.include_router(telemetry_router.router, prefix=API)
app.include_router(search_router.router,    prefix=API)
app.include_router(plugins_router.router,   prefix=API)
app.include_router(tags_router.router,      prefix=API)


@app.get("/api/v1/health", tags=["meta"])
async def health():
    return {"status": "ok", "version": "0.1.0"}


# Serve frontend static files in production (frontend/dist/)
import pathlib
_frontend_dist = pathlib.Path(__file__).parent.parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="static")
