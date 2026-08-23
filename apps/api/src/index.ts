import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import argon2 from "argon2";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";
import { AnswerSchemaByQuestionType, AnswerSubmissionSchema, ProgressSchema, QuestionCatalogSchema, type Question, type Subject } from "@gre/contracts";
import { z } from "zod";

const root = resolve(import.meta.dirname, "../../..");
const catalogsPath = join(root, "generated", "catalogs");
const webDistPath = join(root, "apps", "web", "dist");
const mediaRoot = resolve(process.env.MEDIA_ROOT ?? root);
const isProduction = process.env.NODE_ENV === "production";
const databasePath = process.env.DATABASE_PATH ?? join(root, "generated", "study.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS video_progress (user_id TEXT NOT NULL, video_id TEXT NOT NULL, position_seconds REAL NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,video_id));
CREATE TABLE IF NOT EXISTS question_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question_id TEXT NOT NULL, selected_choice_ids TEXT NOT NULL, correct INTEGER NOT NULL, score REAL NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, submitted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question_state (user_id TEXT NOT NULL, question_id TEXT NOT NULL, bookmarked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,question_id));
CREATE INDEX IF NOT EXISTS sessions_active_user_idx ON sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS video_progress_user_idx ON video_progress (user_id, updated_at);
CREATE INDEX IF NOT EXISTS question_attempts_user_idx ON question_attempts (user_id, submitted_at);
`);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1");
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  });
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  if (!isProduction || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const expectedOrigin = process.env.ALLOWED_ORIGIN;
  if (!expectedOrigin || origin !== expectedOrigin) return res.status(403).json({ error: "Request origin is not allowed." });
  next();
});
app.use(express.json({ limit: "120kb" })); app.use(cookieParser());
const now = () => new Date().toISOString(); const uid = () => randomBytes(18).toString("base64url"); const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
type CurrentUser = { id: string; username: string };
declare global { namespace Express { interface Request { user?: CurrentUser } } }

type RateLimit = { count: number; resetAt: number };
const rateLimits = new Map<string, RateLimit>();
function rateLimit(prefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const key = `${prefix}:${req.ip}`; const timestamp = Date.now(); const current = rateLimits.get(key);
    const value = !current || current.resetAt <= timestamp ? { count: 1, resetAt: timestamp + windowMs } : { ...current, count: current.count + 1 };
    rateLimits.set(key, value); res.set("RateLimit-Limit", String(maxRequests)); res.set("RateLimit-Reset", String(Math.ceil(value.resetAt / 1000)));
    if (value.count > maxRequests) { res.set("Retry-After", String(Math.ceil((value.resetAt - timestamp) / 1000))); return res.status(429).json({ error: "Too many requests. Please try again shortly." }); }
    next();
  };
}
setInterval(() => { const timestamp = Date.now(); for (const [key, value] of rateLimits) if (value.resetAt <= timestamp) rateLimits.delete(key); }, 60_000).unref();

async function createSession(res: Response, user: CurrentUser) {
  const token = randomBytes(32).toString("base64url"); const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  db.prepare("INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(uid(), tokenHash(token), user.id, expires, now());
  res.cookie("gre_session", token, { httpOnly: true, sameSite: isProduction ? "strict" : "lax", secure: isProduction, maxAge: 1000 * 60 * 60 * 24 * 30, path: "/" });
}
app.use((req, _res, next) => {
  const token = req.cookies.gre_session; if (!token) return next();
  const row = db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`).get(tokenHash(token), now()) as CurrentUser | undefined;
  if (row) req.user = row; next();
});
function requireUser(req: Request, res: Response, next: express.NextFunction) { if (!req.user) return res.status(401).json({ error: "Session expired. Sign in to save progress." }); next(); }

app.post("/api/auth/register", rateLimit("register", 8, 15 * 60_000), async (req, res, next) => { try {
  const input = z.object({ username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/), password: z.string().min(10).max(200) }).parse(req.body);
  const user = { id: uid(), username: input.username.toLowerCase() };
  try { db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(user.id, user.username, await argon2.hash(input.password, { type: argon2.argon2id }), now()); }
  catch (error: any) { if (error.code?.startsWith("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "That username is already in use." }); throw error; }
  await createSession(res, user); res.status(201).json({ user });
} catch (error) { next(error); } });
app.post("/api/auth/login", rateLimit("login", 10, 15 * 60_000), async (req, res, next) => { try {
  const input = z.object({ username: z.string(), password: z.string() }).parse(req.body); const row = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(input.username.trim().toLowerCase()) as any;
  if (!row || !(await argon2.verify(row.password_hash, input.password))) return res.status(401).json({ error: "Username or password is incorrect." });
  await createSession(res, row); res.json({ user: { id: row.id, username: row.username } });
} catch (error) { next(error); } });
app.post("/api/auth/logout", (req, res) => { const token = req.cookies.gre_session; if (token) db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(now(), tokenHash(token)); res.clearCookie("gre_session", { path: "/", httpOnly: true, sameSite: isProduction ? "strict" : "lax", secure: isProduction }).status(204).end(); });
app.get("/api/auth/me", (req, res) => res.json({ user: req.user ?? null }));

type CatalogEntry = { body: Buffer; etag: string; questions?: Question[]; videos?: Array<{ id: string }> };
const catalogCache = new Map<string, CatalogEntry>();
function catalog(kind: "videos" | "questions", subject: Subject) {
  const key = `${kind}-${subject}`; const cached = catalogCache.get(key); if (cached) return cached;
  const body = readFileSync(join(catalogsPath, `${key}.json.gz`)); const parsed = JSON.parse(gunzipSync(body).toString("utf8"));
  const value: CatalogEntry = { body, etag: `\"${parsed.contentVersion}\"`, ...(kind === "questions" ? { questions: QuestionCatalogSchema.parse(parsed).data } : { videos: parsed.data.categories.flatMap((category: { videos: Array<{ id: string }> }) => category.videos) }) }; catalogCache.set(key, value); return value;
}
app.get(/^\/api\/catalog\/(videos|questions)\/(quant|verbal)$/, (req, res, next) => { try {
  const kind = String(req.params[0]) as "videos" | "questions";
  const subject = String(req.params[1]) as Subject;
  const entry = catalog(kind, subject);
  res.set({ "Content-Type": "application/json", "Content-Encoding": "gzip", "ETag": entry.etag, "Cache-Control": "public, max-age=31536000, immutable", "Vary": "Accept-Encoding" });
  if (req.headers["if-none-match"] === entry.etag) return res.status(304).end(); res.send(entry.body);
} catch (error) { next(error); } });
function questionFor(id: string) { const subject = id.startsWith("quant:") ? "quant" : id.startsWith("verbal:") ? "verbal" : null; return subject ? catalog("questions", subject).questions?.find(question => question.id === id) : undefined; }
function videoExists(id: string) { const subject = id.startsWith("quant:") ? "quant" : id.startsWith("verbal:") ? "verbal" : null; return Boolean(subject && catalog("videos", subject).videos?.some(video => video.id === id)); }
function responseFromSelections(question: Question, selectedChoiceIds: string[]) {
  const choices = question.choiceGroups.flatMap(group => group.choices);
  const labelFor = (id: string) => choices.find(choice => choice.id === id)?.label ?? id;
  const selected = selectedChoiceIds.map(labelFor);
  if (question.type === "Multiple Choice") return { question_id: question.id, choice: selected[0] };
  if (question.type === "Multiple Select" || question.type === "Sentence Equivalence") return { question_id: question.id, choices: selected };
  if (question.type === "Quantitative Comparison") return { question_id: question.id, choice: selectedChoiceIds[0] };
  if (question.type === "Numeric Entry (Fraction)") { const [numerator, denominator] = String(selectedChoiceIds[0] ?? "").split("/"); return { question_id: question.id, numerator: Number(numerator), denominator: Number(denominator) }; }
  if (question.type === "Numeric Entry (Not Fraction)") return { question_id: question.id, value: Number(selectedChoiceIds[0]) };
  const blanks = Object.fromEntries(question.choiceGroups.map((group, index) => {
    const selectedId = selectedChoiceIds.find(id => group.choices.some(choice => choice.id === id));
    return [`blank_${index + 1}`, labelFor(selectedId ?? "")];
  }));
  return { question_id: question.id, ...blanks };
}
function sameAnswer(question: Question, received: any) {
  const expected = question.answer;
  if (!expected) return false;
  if (question.type === "Numeric Entry (Fraction)") return received.numerator * expected.denominator === expected.numerator * received.denominator;
  if (question.type === "Numeric Entry (Not Fraction)") return received.value === expected.value;
  if (question.type === "Multiple Choice" || question.type === "Quantitative Comparison") return received.choice === expected.choice;
  if (question.type === "Multiple Select" || question.type === "Sentence Equivalence") return received.choices.length === expected.choices.length && [...received.choices].sort().every((choice, index) => choice === [...expected.choices].sort()[index]);
  const blankCount = Number(question.type.match(/^TC (\d) Blank$/)?.[1] ?? 0);
  return Array.from({ length: blankCount }, (_, index) => received[`blank_${index + 1}`] === expected[`blank_${index + 1}`]).every(Boolean);
}

app.get("/api/me/bootstrap", requireUser, (req, res) => {
  const videos = db.prepare("SELECT video_id AS videoId, position_seconds AS positionSeconds, watched, completed, updated_at AS updatedAt FROM video_progress WHERE user_id = ?").all(req.user!.id);
  const attempts = db.prepare("SELECT question_id AS questionId, correct, score, submitted_at AS submittedAt FROM question_attempts WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 20").all(req.user!.id);
  const bookmarks = db.prepare("SELECT question_id AS questionId FROM question_state WHERE user_id = ? AND bookmarked = 1").all(req.user!.id);
  res.json({ videos, attempts, bookmarks });
});
app.delete("/api/me/progress/:subject", requireUser, (req, res, next) => { try {
  const subject = z.enum(["quant", "verbal"]).parse(req.params.subject); const prefix = `${subject}:%`;
  db.transaction(() => {
    db.prepare("DELETE FROM video_progress WHERE user_id = ? AND video_id LIKE ?").run(req.user!.id, prefix);
    db.prepare("DELETE FROM question_attempts WHERE user_id = ? AND question_id LIKE ?").run(req.user!.id, prefix);
    db.prepare("DELETE FROM question_state WHERE user_id = ? AND question_id LIKE ?").run(req.user!.id, prefix);
  })();
  res.json({ ok: true });
} catch (error) { next(error); } });
app.put("/api/me/videos/:videoId/progress", requireUser, (req, res, next) => { try {
  const input = ProgressSchema.parse(req.body); const videoId = z.string().min(1).parse(req.params.videoId); if (!videoExists(videoId)) return res.status(404).json({ error: "Video is not available." }); db.prepare(`INSERT INTO video_progress (user_id, video_id, position_seconds, watched, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,video_id) DO UPDATE SET position_seconds=excluded.position_seconds, watched=excluded.watched, completed=excluded.completed, updated_at=excluded.updated_at`).run(req.user!.id, videoId, input.positionSeconds, Number(input.watched), Number(input.completed), now());
  res.json({ ok: true });
} catch (error) { next(error); } });
app.post("/api/me/questions/:questionId/attempts", requireUser, (req, res, next) => { try {
  const input = AnswerSubmissionSchema.parse(req.body); const old = db.prepare("SELECT correct, score, selected_choice_ids AS selectedChoiceIds FROM question_attempts WHERE idempotency_key = ? AND user_id = ? AND question_id = ?").get(input.idempotencyKey, req.user!.id, req.params.questionId) as any;
  const question = questionFor(String(req.params.questionId)); if (!question) return res.status(404).json({ error: "Question is not available." });
  const response = AnswerSchemaByQuestionType[question.type].parse(input.response ?? responseFromSelections(question, input.selectedChoiceIds));
  if (response.question_id !== question.id) return res.status(400).json({ error: "That answer belongs to a different question." });
  const valid = new Set(question.type === "Quantitative Comparison" ? ["A", "B", "C", "D"] : question.choiceGroups.flatMap(group => group.choices.map(choice => choice.label)));
  const submittedChoices = "choice" in response ? [response.choice] : "choices" in response ? response.choices : question.type.startsWith("TC ") ? Object.values(response).filter((value, index) => index > 0) : [];
  if (submittedChoices.some(choice => !valid.has(String(choice)))) return res.status(400).json({ error: "That answer does not belong to this question." });
  if (question.type === "Sentence Equivalence" && (!("choices" in response) || response.choices.length !== 2)) return res.status(400).json({ error: "Sentence Equivalence requires exactly two choices." });
  if (question.type.startsWith("TC ") && new Set(submittedChoices).size !== submittedChoices.length) return res.status(400).json({ error: "Choose one answer for each blank." });
  const correct = sameAnswer(question, response); const score = correct ? 1 : 0;
  if (!old) db.prepare("INSERT INTO question_attempts (id,user_id,question_id,selected_choice_ids,correct,score,idempotency_key,submitted_at) VALUES (?,?,?,?,?,?,?,?)").run(uid(), req.user!.id, question.id, JSON.stringify(response), Number(correct), score, input.idempotencyKey, now());
  res.json({ correct: old ? Boolean(old.correct) : correct, score: old ? old.score : score, correctChoiceIds: question.correctChoiceIds, solution: question.solution, hasSolutionVideo: Boolean(question.solution.videoId) });
} catch (error) { next(error); } });
app.put("/api/me/questions/:questionId/bookmark", requireUser, (req, res, next) => { try { const body = z.object({ bookmarked: z.boolean() }).parse(req.body); const questionId = z.string().min(1).parse(req.params.questionId); if (!questionFor(questionId)) return res.status(404).json({ error: "Question is not available." }); db.prepare("INSERT INTO question_state (user_id,question_id,bookmarked,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,question_id) DO UPDATE SET bookmarked=excluded.bookmarked, updated_at=excluded.updated_at").run(req.user!.id, questionId, Number(body.bookmarked), now()); res.json({ bookmarked: body.bookmarked }); } catch (error) { next(error); } });

const mediaMap = () => JSON.parse(readFileSync(join(catalogsPath, "media-map.json"), "utf8")) as Record<string, string>;
function streamFile(file: string, req: Request, res: Response) {
  const size = statSync(file).size; const range = String(req.headers.range ?? "");
  res.set({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  if (!range) { res.set("Content-Length", String(size)); return createReadStream(file, { highWaterMark: 256 * 1024 }).pipe(res); }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) { res.set("Content-Range", `bytes */${size}`); return res.status(416).end(); }
  const start = Number(match[1]); const end = match[2] ? Number(match[2]) : Math.min(start + 8 * 1024 * 1024 - 1, size - 1); if (start >= size || end < start || end >= size) { res.set("Content-Range", `bytes */${size}`); return res.status(416).end(); }
  res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) }); createReadStream(file, { start, end, highWaterMark: 256 * 1024 }).pipe(res);
}
function streamMedia(req: Request, res: Response, next: express.NextFunction) { try {
  const rel = mediaMap()[String(req.params.mediaId)]; if (!rel || rel.includes("..")) return res.status(404).json({ error: "Media is unavailable." });
  const file = resolve(mediaRoot, rel); if (!file.startsWith(`${mediaRoot}/`) || !existsSync(file)) return res.status(404).json({ error: "Media is unavailable." }); streamFile(file, req, res);
} catch (error) { next(error); } }
app.get("/api/media/course/:mediaId", streamMedia); app.get("/api/media/solution/:mediaId", (req, res, next) => { try { const mediaId = z.string().regex(/^[a-zA-Z0-9_-]+$/).parse(req.params.mediaId); const subject = req.query.subject === "verbal" ? "GRE Verbal" : "GRE Quant"; const file = join(mediaRoot, subject, "questions", "solutions", `${mediaId}.mp4`); if (!existsSync(file)) return res.status(404).json({ error: "Solution video is unavailable." }); streamFile(file, req, res); } catch (error) { next(error); } });

app.get("/api/health", (_req, res, next) => { try {
  db.prepare("SELECT 1").get();
  for (const subject of ["quant", "verbal"] as Subject[]) { catalog("videos", subject); catalog("questions", subject); }
  res.json({ status: "ok" });
} catch (error) { next(error); } });

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath, {
    index: false,
    maxAge: "1y",
    immutable: true,
    setHeaders(res, file) {
      if (file.endsWith("index.html") || file.endsWith("sw.js") || file.endsWith("manifest.webmanifest")) res.setHeader("Cache-Control", "no-cache");
    }
  }));
  app.get("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint not found." });
    res.sendFile(join(webDistPath, "index.html"), error => error ? next(error) : undefined);
  });
}

app.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => { console.error(error); const status = error?.name === "ZodError" ? 400 : error?.code?.startsWith("SQLITE_CONSTRAINT") ? 409 : 500; res.status(status).json({ error: status === 400 ? "Please check the submitted fields." : status === 409 ? "This request conflicts with existing data." : "Something went wrong." }); });

if (isProduction && !existsSync(webDistPath)) throw new Error(`Web build is missing at ${webDistPath}. Run npm run build before starting the API.`);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const server = app.listen(port, () => console.log(`GRE Study Desk listening on http://${host}:${port}`));
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true; console.log(`${signal} received; closing server.`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM")); process.once("SIGINT", () => shutdown("SIGINT"));
