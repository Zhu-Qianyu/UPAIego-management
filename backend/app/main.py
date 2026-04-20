"""FastAPI application entry-point."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import engine, Base
from app.routes.devices import router as devices_router

# Path to the built React frontend (populated in Docker image)
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Cyber Cap Fleet Management",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS – allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(devices_router, prefix="/api/devices", tags=["devices"])


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Serve React SPA in production ----------
# Mount static assets (JS/CSS/images) and fall back to index.html for
# client-side routing.  Only active when the static directory exists
# (i.e. inside the Docker image, not during local dev).

if STATIC_DIR.is_dir():
    # Serve /assets/* directly
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Catch-all: serve the file if it exists, otherwise index.html (SPA)."""
        file = STATIC_DIR / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
