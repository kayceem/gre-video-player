from __future__ import annotations

import re
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

VIDEO_EXTS = {".mp4", ".webm", ".mkv", ".mov", ".m4v"}

def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]

@dataclass
class VideoItem:
    title: str
    file: str  # relative posix path from COURSE_DIR
    watched: bool = False
    resume_position: float = 0.0
    updated_at: Optional[str] = None

@dataclass
class Category:
    title: str
    videos: List[VideoItem]


def scan_course(course_dir: Path, course_title: Optional[str] = None) -> Dict[str, Any]:
    """
    Loads course structure from course_dir/playlist.json.

    Accepts input categories items under either:
      - category["contents"] (your format)
      - category["videos"]   (alternate format)

    Normalizes output to:
      { title, categories: [{ title, videos: [{title,file,watched,resume_position,updated_at}]}] }
    """
    course_dir = course_dir.resolve()
    playlist_path = course_dir / "playlist.json"
    if not playlist_path.exists():
        raise FileNotFoundError(f"playlist.json not found at: {playlist_path}")

    raw = json.loads(playlist_path.read_text(encoding="utf-8"))

    title = (raw.get("title") or course_title or course_dir.name)

    categories_out: List[Dict[str, Any]] = []
    for cat in (raw.get("categories") or []):
        cat_title = cat.get("title") or "Untitled"

        items = cat.get("contents")
        if items is None:
            items = cat.get("videos")
        if items is None:
            items = []

        videos_out: List[Dict[str, Any]] = []
        for it in items:
            file = (it.get("file") or "").replace("\\", "/")
            if not file:
                # skip invalid entries
                continue

            videos_out.append({
                "title": it.get("title") or Path(file).stem,
                "file": file,                 # relative to course_dir
            })

        categories_out.append({"title": cat_title, "videos": videos_out})

    return {"title": title, "categories": categories_out}


def merge_progress(playlist: Dict[str, Any], progress_for_user: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    # progress_for_user is keyed by "file"
    for cat in playlist.get("categories", []):
        for v in cat.get("videos", []):
            p = progress_for_user.get(v["file"])
            if p:
                v["watched"] = bool(p.get("watched", False))
                v["resume_position"] = float(p.get("resume_position", 0.0))
                v["updated_at"] = p.get("updated_at")
            else:
                v["watched"] = False
                v["resume_position"] = 0.0
                v["updated_at"] = None
    return playlist