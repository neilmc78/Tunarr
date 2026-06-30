import hashlib
import json
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.requests import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .config import settings
from .database import init_db, SessionLocal
from .models import QualityProfile, User
from .schemas import QUALITY_DEFINITIONS
from .download_manager import process_pending_queue
from .api import artist, album, track, command, queue, history, wanted, settings as settings_api, system, search, auth, requests as requests_api

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tunarr")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Tunarr starting — initialising database")
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.downloads_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.music_dir).mkdir(parents=True, exist_ok=True)

    init_db()
    _seed_quality_profiles()

    logger.info("Resuming pending downloads")
    await process_pending_queue()

    logger.info("Tunarr ready on port %s", settings.port)
    yield
    logger.info("Tunarr shutting down")


def _seed_quality_profiles():
    """Ensure the three default profiles exist (by name), preserving any user-created ones."""
    defaults = [
        {
            "name": "Any",
            "upgrade_allowed": True,
            "cutoff": 1,
            "items": QUALITY_DEFINITIONS,
        },
        {
            "name": "Best Native",
            "upgrade_allowed": False,
            "cutoff": 8,
            "items": [q for q in QUALITY_DEFINITIONS if q["id"] == 8],
        },
        {
            "name": "MP3 Standard",
            "upgrade_allowed": True,
            "cutoff": 3,
            "items": [q for q in QUALITY_DEFINITIONS if q["id"] in {1, 2, 3, 4, 5}],
        },
        {
            "name": "FLAC Preferred",
            "upgrade_allowed": True,
            "cutoff": 6,
            "items": [q for q in QUALITY_DEFINITIONS if q["id"] in {6, 7}],
        },
    ]
    db = SessionLocal()
    try:
        for d in defaults:
            if not db.query(QualityProfile).filter(QualityProfile.name == d["name"]).first():
                db.add(QualityProfile(
                    name=d["name"],
                    upgrade_allowed=d["upgrade_allowed"],
                    cutoff=d["cutoff"],
                    items=json.dumps(d["items"]),
                ))
        db.commit()
        logger.info("Quality profiles seeded")
    finally:
        db.close()


_session_key = settings.get_or_create_session_key()


class _AuthMiddleware(BaseHTTPMiddleware):
    """Block unauthenticated access to all /api/v3/ routes except /api/v3/auth/*."""
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/v3/") or path.startswith("/api/v3/auth"):
            return await call_next(request)

        uid = request.session.get("user_id")
        if not uid:
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)

        db = SessionLocal()
        try:
            user = db.get(User, uid)
            if not user:
                request.session.clear()
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
            if request.method not in ("GET", "HEAD", "OPTIONS") and user.role != "admin":
                # Allow non-admins to toggle monitoring on tracks/albums and submit requests
                allowed = (
                    (path.startswith("/api/v3/track/") and request.method == "PUT") or
                    (path == "/api/v3/track/monitor" and request.method == "PUT") or
                    (path.startswith("/api/v3/album/") and request.method == "PUT") or
                    (path == "/api/v3/requests" and request.method == "POST")
                )
                if not allowed:
                    return JSONResponse({"detail": "Admin required"}, status_code=403)
        finally:
            db.close()

        return await call_next(request)


app = FastAPI(
    title="Tunarr",
    description="Individual track download manager — Sonarr for music tracks",
    version="1.0.0",
    lifespan=lifespan,
)

# Middleware order: SessionMiddleware runs first (outermost), then _AuthMiddleware.
# add_middleware prepends, so add _AuthMiddleware first, then SessionMiddleware.
app.add_middleware(_AuthMiddleware)
app.add_middleware(SessionMiddleware, secret_key=_session_key, https_only=False, same_site="lax")

for r in [
    auth.router,
    requests_api.router,
    artist.router,
    album.router,
    track.router,
    command.router,
    queue.router,
    history.router,
    wanted.router,
    settings_api.router,
    system.router,
    search.router,
]:
    app.include_router(r)

_static = Path(__file__).parent.parent / "static"


def _asset_version() -> str:
    """Return an 8-char hash derived from the newest mtime in the static tree."""
    try:
        newest = max(
            (f.stat().st_mtime for f in _static.rglob("*") if f.is_file()),
            default=0,
        )
        return hashlib.md5(str(int(newest)).encode()).hexdigest()[:8]
    except Exception:
        return "0"


if _static.exists():
    app.mount("/assets", StaticFiles(directory=str(_static)), name="static")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str = ""):
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(404)
        index = _static / "index.html"
        v = _asset_version()
        html = index.read_text()
        # Append ?v=<hash> to every /assets/ URL so browsers re-fetch after updates
        html = re.sub(r'((?:href|src)="/assets/[^"]+)"', rf'\1?v={v}"', html)
        return HTMLResponse(
            content=html,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
