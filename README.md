# GRE Study Desk

GRE Study Desk is a single-origin web application for course video playback, practice questions, and account-backed progress.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. The Vite server proxies API calls to the API at port 8787.

Before a release, run:

```bash
npm run test
npm run build
```

`npm run build` regenerates the catalogs, so it requires the local course-media directories. For a container image that uses already-generated catalogs, use `docker compose build`.

## Course data and video folder structure

Course content is kept in two source directories at the repository root. The catalog importer currently reads only `GRE Quant/` and `GRE Verbal/`:

```text
GRE Quant/
├── info.json                         # Course metadata, categories, and lesson titles
├── <category title>/                 # One folder for each video category
│   ├── <lesson title>.mp4            # Course lesson video
│   └── ...
├── questions/
│   ├── quant_question.json           # Quant question export
│   ├── images/                       # Images referenced by question bodies
│   └── solutions/<video-id>.mp4      # Local solution videos, named by Vimeo ID
├── mountain/                         # Quant flashcard source data
└── playlists/                        # Optional playlist files

GRE Verbal/
├── info.json
├── <category title>/
│   ├── <lesson title>.mp4
│   └── ...
├── questions/
│   ├── verb_question.json            # Verbal question export
│   ├── images/                       # Optional question images
│   └── solutions/<video-id>.mp4
├── mountain/                         # Vocabulary flashcard source data
├── playlists/
└── skills/                           # Additional verbal source data
```

### Adding or replacing a course video

1. Add or update the lesson entry in the relevant `info.json` category. The category title and lesson title should describe the corresponding folders and `.mp4` file.
2. Put the video at `GRE Quant/<category title>/<lesson title>.mp4` or `GRE Verbal/<category title>/<lesson title>.mp4`.
3. Run `npm run import:catalog` (or `npm run build`) from the repository root.
4. The importer writes the normalized catalog and media lookup to `generated/catalogs/`. Do not edit those generated files by hand.

The importer matches names after normalizing case, punctuation, common numbering, and a few known naming variations. If a lesson cannot be matched safely, add an entry to `scripts/media-aliases.json` using this format:

```json
{
  "quant/Category title/Lesson title": "Category title/actual-video-filename.mp4"
}
```

Keep course videos as `.mp4` files. The API streams them from the directory configured by `MEDIA_ROOT`; in Docker Compose, `GRE Quant/` and `GRE Verbal/` are mounted read-only at `/media`.

### Question data and related media

- Quant questions must remain in `GRE Quant/questions/quant_question.json`.
- Verbal questions must remain in `GRE Verbal/questions/verb_question.json`.
- Question images belong in the matching `questions/images/` directory. The filename referenced by the question export must exist there.
- Question solution videos belong in `questions/solutions/` and must be named `<Vimeo ID>.mp4` so the importer can connect them to the source solution URL.

The memorize page loads its browser assets from `apps/web/public/data/` (`vocab_mountain.json`, `quant_mountain.json`, and `quant_mountain_overwhelmed.json`). The source files are under the matching `mountain/` directories; the current Quant overwhelmed source is historically named `quant_mountain_overwehlmed.json`. When updating any of these source files, copy the updated JSON into `apps/web/public/data/` as well; the current build has no automatic mountain-data sync step.

## Production deployment

The API serves the built web application, API, and SPA fallback from one origin. Put a TLS-terminating reverse proxy in front of port 8787 and forward `Host` and `X-Forwarded-Proto` headers. Do not expose the application directly over HTTP: production session cookies require HTTPS.

1. Keep `GRE Quant/` and `GRE Verbal/` on the host; they are mounted read-only and deliberately excluded from the image.
2. Copy `.env.example` to `.env` and set `ALLOWED_ORIGIN` to the exact public HTTPS origin.
3. Run `docker compose up -d --build`.
4. Configure the platform health check as `GET /api/health` and persist the `study-data` volume.

The service listens on port 8787. `DATABASE_PATH` should point to durable storage, and `MEDIA_ROOT` should point to the directory that contains the two course directories. Set `TRUST_PROXY=true` only when the container is directly behind a reverse proxy you control.

The bundled rate limit protects login and registration on a single instance. For horizontally scaled deployments, use a shared edge or application rate limiter before enabling multiple API instances.

### Repository hygiene

SQLite runtime files are ignored so no account or session data is added going forward. If this repository still tracks the existing bootstrap database, remove it from Git’s index before publishing while retaining your local copy:

```bash
git rm --cached generated/study.sqlite generated/study.sqlite-shm generated/study.sqlite-wal
```
