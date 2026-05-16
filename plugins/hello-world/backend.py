"""Minimal example plugin — exercises the plugin contract."""
from fastapi import APIRouter


def register_routes(router: APIRouter) -> None:
    @router.get("/hello")
    async def hello():
        return {"message": "Hello from the hello-world plugin!"}
