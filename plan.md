  # GRE Prep PWA — implementation plan

  ## Summary

  Build a TypeScript monorepo with a React/Vite web client and
  Express.js API, backed by SQLite. The app is a fast, keyboard-friendly
  GRE study tool with:

  - Course video tracking for Quant and Verbal
  - Immediate-feedback question practice with written and video
  solutions
  - Simple username/password accounts
  - An installable iOS PWA that caches the app and four gzip-compressed
  immutable catalogs, but streams video only online

  The interface will be an “operate” surface: dense, calm, highly
  scannable, with a persistent desktop navigation rail, mobile bottom
  navigation, command palette, and visible keyboard shortcuts.

  ## Data model and import pipeline

  - Create a TypeScript/Zod data-contract package used by the importer,
  API, and web app.
  - Add a build-time import command that reads:
    - `GRE Quant/info.json` and `GRE Verbal/info.json` for course
  structure and video metadata
    - `GRE Quant/questions/quant_question.json` and `GRE Verbal/
  questions/verb_question.json` for full question records
    - `GRE Verbal/skills/pairing.json` for validated, future-use skill
  data only
  - Strip all legacy user-specific fields (`watched`, `saved`, attempts,
  bookmarks, likes, status) from published catalogs.
  - Generate four versioned, schema-validated catalog artifacts:
    - `videos-quant.json.gz`
    - `videos-verbal.json.gz`
    - `questions-quant.json.gz`
    - `questions-verbal.json.gz`
  - Each artifact uses `{ schemaVersion, contentVersion, generatedAt,
  subject, data }`. `contentVersion` is a content hash and drives client
  cache invalidation.
  - Resolve course video files during import rather than in the browser.
  Match the category plus title against the actual local MP4 inventory;
  use the legacy playlist as a reference, record the exact relative
  media path, fail the import on ambiguous/missing files, and allow an
  explicit alias map for exceptional cleaned filenames such as `What if
  I Can't Pair?` → `What if I cant Pair.mp4`.
  - Convert Vimeo-derived solution references to local media IDs only. A
  valid solution video becomes `solutionVideoId`, mapped to `questions/
  solutions/{vimeo_id}.mp4`; no Vimeo URL or embed HTML is served.
  - Preserve source question HTML only after sanitizing it to a defined
  safe subset. Render math with KaTeX; retain supported diagrams/SVG
  content, strip scripts, event handlers, embeds, and remote unsafe
  content.

  Published question schema:

  ```ts
  type Subject = "quant" | "verbal";

  interface Question {
    id: `${Subject}:${string}`;          // stable source slug, unique
  per subject
    subject: Subject;
    type: string;
    difficulty: "Easy" | "Medium" | "Hard" | null;
    title: string;
    promptHtml: string;
    choiceGroups: Array<{
      id: string;
      title: string;
      choices: Array<{ id: string; label: string; bodyHtml: string;
  order: number }>;
    }>;
    correctChoiceIds: string[];
    scoring: { requiredCorrect: number; total: number };
    solution: { html: string; videoId: string | null };
    metadata: { source: string | null; acceptanceRate: number | null };
  }
  ```

  Published video schema:

  ```ts
  interface VideoCatalog {
    subject: Subject;
    title: string;
    categories: Array<{
      id: string;
      title: string;
      descriptionHtml: string;
      videos: Array<{
        id: string;
        title: string;
        descriptionHtml: string;
        durationSeconds: number | null;
        mediaId: string;
        categoryId: string;
        order: number;
      }>;
    }>;
  }
  ```

  Persist only user-owned state in SQLite:

  - `users`: ID, unique normalized username, Argon2id password hash,
  timestamps
  - `sessions`: opaque hashed token, user ID, expiry/revocation
  timestamps
  - `video_progress`: user/video key, resume position, watched/completed
  state, updated timestamp
  - `question_attempts`: immutable answer history with selected choices,
  correctness, score, submitted timestamp
  - `question_state`: optional bookmark state for a user/question
  - `schema_migrations`: migration history

  ## API, media, and authentication

  - Serve exactly four independent public catalog endpoints under `/api/
  catalog/{videos|questions}/{quant|verbal}` with pre-generated gzip
  bodies, `Content-Encoding: gzip`, ETags, immutable versioned cache
  headers, and conditional GET support.
  - Keep all personal endpoints separate under `/api/me`; catalog
  requests never include progress or attempt data.
  - Provide minimal account routes: register, log in, log out, and
  current-user session. Use secure, `HttpOnly`, `SameSite=Lax` session
  cookies; require HTTPS in production. No email, recovery, or password-
  reset flow.
  - Provide authenticated endpoints for:
    - Bulk user bootstrap/progress summary
    - Upserting video resume/watched progress
    - Submitting a question answer
    - Listing recent attempts and bookmarks
  - Validate answers server-side from the imported catalog, store one
  immutable attempt per submission, and return immediate feedback:
  correctness, score, correct choices, written solution, and local
  solution-video availability.
  - Use idempotency keys for queued offline progress/attempt writes so
  reconnecting cannot duplicate attempts.
  - Stream all MP4s through allowlisted media IDs, never raw client
  filesystem paths. Implement single-byte-range support (`206`,
  `Content-Range`, `Accept-Ranges`, correct MIME/cache headers), bounded
  streaming chunks, traversal protection, and distinct routes for course
  and solution media.

  ## Web experience and PWA behavior

  - On app launch, fetch the four catalog endpoints in parallel, hydrate
  an IndexedDB catalog cache, then fetch authenticated user state
  independently.
  - Build fast routes for Dashboard, Learn, Practice, and Account.
  Dashboard surfaces resume-next video, course completion, and recent
  practice.
  - Learn uses a searchable/collapsible category list, native video
  controls, resume-at-last-position, completion at a defined near-end
  threshold, next/previous controls, and a visible course-progress
  summary.
  - Practice supports subject, type, difficulty, and unanswered/
  bookmarked filters; renders one question at a time; disables answer
  changes after submission; then shows feedback, explanation, and an
  inline local solution player when present.
  - Add desktop shortcuts: `/` focus search, `g` then `l`/`p` navigate
  Learn/Practice, `j`/`k` move list selection, `Enter` open/submit, `n`
  next item, `Space` play/pause video, and `?` opens the shortcut
  reference. Inputs and video controls retain their native behavior.
  - Use URL state for selected subject, filters, current video, and
  current question so study sessions are bookmarkable and restore
  predictably.
  - Provide clear loading, offline, invalid-data, missing-media, and
  session-expired states. Dynamic user data is never stored in the
  service-worker cache.
  - Configure PWA manifest, 180px/192px/512px icons, Apple touch icon,
  standalone display, theme/status-bar metadata, and a service worker
  suitable for iOS Safari.
  - Precache the app shell and cache the four versioned catalog
  responses. Do not cache media responses or offer video downloads.
  Store unsent user mutations in IndexedDB and replay them on app start
  and `online`; do not depend on iOS Background Sync.

  ## Verification

  - Unit-test source adapters, legacy-field stripping, deterministic
  IDs, filename/solution-video resolution, HTML sanitization, and Zod
  schema failures.
  - Test API authentication, duplicate usernames, session expiry,
  progress upserts, answer evaluation, idempotency, catalog gzip/ETag
  behavior, and valid/invalid HTTP byte-range requests.
  - Add browser tests for first load, account creation, course resume/
  completion, Quant and Verbal answer flows, written/video solution
  display, keyboard shortcuts, offline catalog study, queued mutation
  replay, and installed-PWA behavior.
  - Build and inspect the interface at desktop and iPhone viewport
  sizes; validate iOS PWA installation metadata and confirm catalogs are
  available after an offline reload while video appropriately reports
  that a connection is required.

  ## Assumptions

  - The newly added Quant source (`quant_question.json`) is the
  authoritative full Quant question dataset; both question catalogs are
  currently valid and share the normalized nested source shape.
  - Existing question answer keys and explanations are acceptable in the
  downloadable catalogs; server-side evaluation remains authoritative
  for persisted progress.