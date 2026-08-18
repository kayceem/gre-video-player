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

`npm run build` regenerates the catalogs, so it requires the local course-media directories. For a container image that uses the committed generated catalogs, use `docker compose build`.

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
