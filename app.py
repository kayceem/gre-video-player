from __future__ import annotations

import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import Body, Cookie, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from playlist import merge_progress, scan_course
from storage import load_json, save_json

APP_ROOT = Path(__file__).resolve().parent
COURSE_DIR = (APP_ROOT / "GRE Verbal").resolve()          # ./title
PROGRESS_PATH = (APP_ROOT / "progress.json").resolve()
FRONTEND_DIST = (APP_ROOT / "frontend" / "dist").resolve()

DEFAULT_PROGRESS: Dict[str, Any] = {"users": {}}

app = FastAPI(title="Course Video Player")

# Dev convenience (vite). In production, frontend is served by this same app.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_or_set_sid(response: Response, sid: Optional[str]) -> str:
    if sid and len(sid) >= 8:
        return sid
    new_sid = str(uuid.uuid4())
    response.set_cookie(
        "sid",
        new_sid,
        httponly=False,   # readable by browser if you want; not required
        samesite="lax",
        secure=False,     # set True behind HTTPS
        max_age=60 * 60 * 24 * 365 * 5,
    )
    return new_sid

def _safe_resolve_video(rel_path: str) -> Path:
    # Prevent path traversal
    candidate = (COURSE_DIR / rel_path).resolve()
    if not str(candidate).startswith(str(COURSE_DIR) + str(Path("/").anchor).replace("\\", "")) and candidate != COURSE_DIR:
        # The above anchor trick can be finicky on Windows; do a simpler check too:
        pass
    if COURSE_DIR not in candidate.parents and candidate != COURSE_DIR:
        raise HTTPException(status_code=400, detail="Invalid video path")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return candidate

def _parse_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    # Accept: "bytes=start-end"
    if not range_header:
        return None
    if not range_header.startswith("bytes="):
        return None
    part = range_header[len("bytes="):].strip()
    if "," in part:
        # multiple ranges not supported
        return None
    start_s, _, end_s = part.partition("-")
    try:
        if start_s == "":
            # suffix bytes: "-500"
            suffix_len = int(end_s)
            if suffix_len <= 0:
                return None
            start = max(0, file_size - suffix_len)
            end = file_size - 1
            return (start, end)
        start = int(start_s)
        end = int(end_s) if end_s != "" else file_size - 1
        if start < 0 or end < start:
            return None
        end = min(end, file_size - 1)
        return (start, end)
    except ValueError:
        return None

class VideoProgressIn(BaseModel):
    file: str = Field(..., description="Relative video path as returned by /playlist")
    resume_position: float = Field(..., ge=0)
    watched: bool = False

def ensure_sid(sid: Optional[str]) -> Tuple[str, bool]:
    if sid and len(sid) >= 8:
        return sid, False
    return str(uuid.uuid4()), True

def attach_sid_cookie(resp: Response, sid: str) -> None:
    resp.set_cookie(
        "sid",
        sid,
        httponly=False,
        samesite="lax",
        secure=False,  # set True if you serve over HTTPS
        max_age=60 * 60 * 24 * 365 * 5,
    )

@app.get("/playlist")
def get_playlist(sid: Optional[str] = Cookie(default=None)) -> JSONResponse:
    sid_val, created = ensure_sid(sid)

    playlist = scan_course(COURSE_DIR)
    db = load_json(PROGRESS_PATH, DEFAULT_PROGRESS)
    user_progress = db.get("users", {}).get(sid_val, {})
    playlist = merge_progress(playlist, user_progress)

    resp = JSONResponse(playlist)
    if created:
        attach_sid_cookie(resp, sid_val)
    return resp

@app.get("/progress")
def get_progress(sid: Optional[str] = Cookie(default=None)) -> JSONResponse:
    sid_val, created = ensure_sid(sid)

    db = load_json(PROGRESS_PATH, DEFAULT_PROGRESS)
    data = db.get("users", {}).get(sid_val, {})

    resp = JSONResponse(data)
    if created:
        attach_sid_cookie(resp, sid_val)
    return resp

@app.post("/video-progress")
def save_progress(payload: VideoProgressIn, sid: Optional[str] = Cookie(default=None)) -> JSONResponse:
    sid_val, created = ensure_sid(sid)

    _safe_resolve_video(payload.file)

    db = load_json(PROGRESS_PATH, DEFAULT_PROGRESS)
    users = db.setdefault("users", {})
    user = users.setdefault(sid_val, {})

    user[payload.file] = {
        "resume_position": float(payload.resume_position),
        "watched": bool(payload.watched),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    save_json(PROGRESS_PATH, db)

    resp = JSONResponse({"ok": True})
    if created:
        attach_sid_cookie(resp, sid_val)
    return resp

@app.get("/videos/{video_path:path}")
def stream_video(
    video_path: str,
    request: Request,
    range: Optional[str] = Header(default=None),
):
    file_path = _safe_resolve_video(video_path)
    file_size = file_path.stat().st_size
    content_type, _ = mimetypes.guess_type(str(file_path))
    content_type = content_type or "application/octet-stream"

    byte_range = _parse_range(range, file_size) if range else None
    if not byte_range:
        # Full file
        return FileResponse(
            path=file_path,
            media_type=content_type,
            filename=file_path.name,
            headers={"Accept-Ranges": "bytes"},
        )

    start, end = byte_range
    length = end - start + 1

    def iterfile():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = length
            chunk = 1024 * 1024
            while remaining > 0:
                read_size = min(chunk, remaining)
                data = f.read(read_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    return StreamingResponse(iterfile(), status_code=206, media_type=content_type, headers=headers)

# Serve built frontend (Vite dist) if present
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")