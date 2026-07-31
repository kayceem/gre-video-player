# GregMat

A self-hosted video course player for GRE study materials. It scans a course folder, serves the videos in a browser with range-based streaming, and tracks per-user progress (resume position, "watched" status) via a cookie-based session.

## Features

- Course playlist loaded from `playlist.json`
- Browser video streaming with HTTP range request support (seeking works)
- Per-user progress tracking: resume position and "watched" flag, persisted in `progress.json`
- Dark / light mode, video search, watched/unwatched filters
- Mobile-friendly UI

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js + npm (only needed to build or develop the frontend)

## Project structure

```
.
├── app.py            # FastAPI backend (API + video streaming + serves built frontend)
├── playlist.py       # Scans course dir / playlist.json and merges user progress
├── storage.py        # Atomic JSON read/write helpers (progress.json)
├── creator.py        # Helper: converts the raw course info.json into playlist.json
├── frontend/         # React + Vite + Tailwind web UI
└── GRE Verbal/       # Example course folder (videos + playlist.json)
```

## Installation

### 1. Backend

```bash
uv sync
```

### 2. Frontend

```bash
cd frontend
npm install
cd ..
```

## Course setup

The player expects a course folder (default: `./GRE Verbal`) containing video files organized by category subfolders, plus a `playlist.json` that describes the structure:

```json
{
  "title": "GRE Verbal",
  "categories": [
    {
      "title": "Text Completion and Sentence Equivalence Strategy",
      "contents": [
        {
          "title": "The Pairing Strategy",
          "file": "Text Completion and Sentence Equivalence Strategy/The Pairing Strategy.mp4"
        }
      ]
    }
  ]
}
```

Supported video extensions: `.mp4`, `.webm`, `.mkv`, `.mov`, `.m4v`.

If you have the raw course export (`info.json` with `categories[].contents[]` entries), you can generate `playlist.json`:

```bash
# Put info.json in the course folder, then run from the project root:
uv run python creator.py
```

Point the backend at your course folder by changing `COURSE_DIR` in `app.py`:

```python
COURSE_DIR = (APP_ROOT / "GRE Verbal").resolve()   # e.g. (APP_ROOT / "GRE Quant")
```

## Usage

### Development (Vite dev server with hot reload)

Start the backend on port 8000:

```bash
uv run uvicorn app:app --reload
```

In a second terminal, start the frontend dev server (proxies API calls to the backend):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

### Production (backend serves the built frontend)

Build the frontend once:

```bash
cd frontend
npm run build
cd ..
```

The backend automatically serves `frontend/dist` when it exists. Start the app:

```bash
uv run uvicorn app:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000.

## API endpoints

| Method | Path             | Description                                          |
| ------ | ---------------- | ---------------------------------------------------- |
| GET    | `/playlist`      | Course structure with per-user progress merged in    |
| GET    | `/progress`      | Raw progress for the current session                 |
| POST   | `/video-progress`| Save resume position / watched flag for a video      |
| GET    | `/videos/{path}` | Stream a video file (supports `Range` headers)       |

Progress is tied to a `sid` cookie that is issued on first request, so each browser gets its own progress.
