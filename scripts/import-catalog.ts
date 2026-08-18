import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { QuestionCatalogSchema, VideoCatalogEnvelopeSchema, type Answer, type Question, type Subject, type VideoCatalog } from "@gre/contracts";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "generated", "catalogs");
const allowMissingMedia = process.argv.includes("--allow-missing-media");
const aliases: Record<string, string> = JSON.parse(readFileSync(join(root, "scripts", "media-aliases.json"), "utf8"));
const numerals: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
const substitutions: Record<string, string> = { gcf: "greatest common factor", lcm: "least common multiple", pf: "prime factorization", sd: "standard deviation", cant: "cannot", versus: "vs", intergers: "integers" };
const noise = new Set(["the", "a", "an", "of", "to", "and", "in", "with", "for", "by", "on", "at", "all", "part", "solutions", "solution", "copy", "updated", "prepswift", "quant", "verbal", "foundation", "column", "arithmetic"]);
/** Normalizes ordinary download cleanup (# → Number, words/Roman numerals, punctuation and known naming noise). */
const clean = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/greatest common factor\s*(?:\(\s*)?gcf\)?/g, "greatest common factor").replace(/least common multiple\s*(?:\(\s*)?lcm\)?/g, "least common multiple").replace(/prime factorization\s*(?:\(\s*)?pf\)?/g, "prime factorization").replace(/\((?:gcf|lcm|pf|sd)\)/g, "").replace(/#/g, " number ").replace(/&/g, " and ").replace(/²/g, " squared ").replace(/³/g, " cubed ").match(/[a-z0-9]+/g)?.flatMap(token => (substitutions[token] ?? token).split(" ")).map(token => numerals[token] ?? token).filter(token => !noise.has(token)).join("") ?? "";
const id = (subject: Subject, slug: string) => `${subject}:${slug}`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** Defined safe subset. Inline styles are deliberately discarded, while SVG diagrams stay intact. */
function sanitizeHtml(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let html = raw.replace(/<!--[^]*?-->/g, "").replace(/<(script|iframe|object|embed|style|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<(script|iframe|object|embed|style|link|meta)\b[^>]*\/?\s*>/gi, "");
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "");
  html = html.replace(/\s(?:src|href)\s*=\s*("|')(?!#|\/|data:image\/svg\+xml)[^"']*\1/gi, "");
  return html.replace(/\s+(?:class|id)\s*=\s*("[^"]*"|'[^']*')/gi, "").trim();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const full = join(dir, name); return statSync(full).isDirectory() ? walk(full) : [full]; });
}

function makeMediaIndex(subject: Subject) {
  const sourceRoot = join(root, subject === "quant" ? "GRE Quant" : "GRE Verbal");
  const entries = walk(sourceRoot).filter(file => file.toLowerCase().endsWith(".mp4"));
  return { sourceRoot, entries };
}

function editDistance(left: string, right: string) { const row = Array.from({ length: right.length + 1 }, (_, i) => i); for (let i = 1; i <= left.length; i++) { let diagonal = row[0]; row[0] = i; for (let j = 1; j <= right.length; j++) { const previous = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1])); diagonal = previous; } } return row[right.length]; }
function findCourseMedia(subject: Subject, category: string, title: string, index: ReturnType<typeof makeMediaIndex>): string {
  const alias = aliases[`${subject}/${category}/${title}`];
  if (alias) { const full = join(index.sourceRoot, alias); if (existsSync(full)) return relative(root, full).replaceAll("\\", "/"); throw new Error(`${subject}: alias for ${category} / ${title} points to a missing file: ${alias}`); }
  const wanted = clean(title);
  const candidates = index.entries.map(file => ({ file, category: clean(relative(index.sourceRoot, dirname(file)).split("/")[0] ?? ""), title: clean(file.slice(file.lastIndexOf("/") + 1).replace(/\.mp4$/i, "")) }));
  const exact = candidates.filter(candidate => candidate.title === wanted && candidate.category === clean(category));
  const globalExact = candidates.filter(candidate => candidate.title === wanted);
  const pool = exact.length ? exact : globalExact.length ? globalExact : candidates;
  const ranked = pool.map(candidate => ({ candidate, distance: editDistance(wanted, candidate.title) / Math.max(wanted.length, candidate.title.length, 1), categoryMatch: candidate.category === clean(category) })).sort((a, b) => a.distance - b.distance || Number(b.categoryMatch) - Number(a.categoryMatch));
  const best = ranked[0]; const next = ranked[1];
  const safe = best && (best.distance <= 0.16 || (best.candidate.title.includes(wanted) && wanted.length >= 7)) && (!next || best.distance + 0.05 < next.distance || best.categoryMatch !== next.categoryMatch);
  if (!safe) throw new Error(`${subject}: ${category} / ${title}: unable to resolve local MP4${best ? ` (closest ${relative(index.sourceRoot, best.candidate.file)} at ${Math.round(best.distance * 100)}%)` : ""}`);
  return relative(root, best.candidate.file).replaceAll("\\", "/");
}

function vimeoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.match(/(?:video\/|vimeo\.com\/)(\d+)/)?.[1] ?? null;
}

function sourceAnswer(data: any): string[] {
  const answer = data.answer;
  if (Array.isArray(answer?.data)) return answer.data.map(String);
  if (typeof answer?.choice === "string") return [answer.choice];
  if (Array.isArray(answer?.choices)) return answer.choices.map(String);
  if (typeof answer?.value === "number" || typeof answer?.value === "string") return [String(answer.value)];
  const given = data.answer_data?.given_answer;
  if (typeof given === "string") return given.split(/[\s,]+/).filter(Boolean);
  return [];
}
function answerFor(data: any, questionId: string, type: string): Answer | null {
  const raw = data.answer ?? {}; const values = sourceAnswer(data); const letters = values.flatMap(value => value.match(/^[A-I]+$/i) ? value.toUpperCase().split("") : [value]);
  if (!values.length && !raw.blank_1 && !raw.numerator && !raw.denominator) return null;
  if (type === "Multiple Choice") return { question_id: questionId, choice: String(raw.choice ?? letters[0] ?? values[0]) };
  if (type === "Multiple Select") return { question_id: questionId, choices: (raw.choices ?? letters).map(String) };
  if (type === "Sentence Equivalence") return { question_id: questionId, choices: (raw.choices ?? letters).map(String).slice(0, 2) };
  if (type === "Quantitative Comparison") return { question_id: questionId, choice: (["A", "B", "C", "D"].includes(String(raw.choice ?? letters[0])) ? String(raw.choice ?? letters[0]) : "A") as "A" | "B" | "C" | "D" };
  if (type === "Numeric Entry (Fraction)") { const [numerator, denominator] = String(raw.value ?? values[0] ?? "0/1").split("/").map(Number); return { question_id: questionId, numerator: Number(raw.numerator ?? numerator), denominator: Number(raw.denominator ?? denominator ?? 1) || 1 }; }
  if (type === "Numeric Entry (Not Fraction)") return { question_id: questionId, value: Number(raw.value ?? values[0] ?? 0) };
  if (type === "TC 1 Blank") return { question_id: questionId, blank_1: String(raw.blank_1 ?? letters[0] ?? "") };
  if (type === "TC 2 Blank") return { question_id: questionId, blank_1: String(raw.blank_1 ?? letters[0] ?? ""), blank_2: String(raw.blank_2 ?? letters[1] ?? "") };
  if (type === "TC 3 Blank") return { question_id: questionId, blank_1: String(raw.blank_1 ?? letters[0] ?? ""), blank_2: String(raw.blank_2 ?? letters[1] ?? ""), blank_3: String(raw.blank_3 ?? letters[2] ?? "") };
  return null;
}

function buildQuestions(subject: Subject): Question[] {
  const base = subject === "quant" ? "GRE Quant" : "GRE Verbal";
  const name = subject === "quant" ? "quant_question.json" : "verb_question.json";
  const source = JSON.parse(readFileSync(join(root, base, "questions", name), "utf8"));
  const solutionDir = join(root, base, "questions", "solutions");
  return source.results.filter((record: any) => record.status === "success" && record.data).map((record: any) => {
    const data = record.data;
    const groups = (data.choice_groups ?? []).map((group: any, gi: number) => ({
      id: `${id(subject, data.slug)}:g${gi + 1}`, title: String(group.title ?? "Choices"), choices: (group.choices ?? []).map((choice: any, ci: number) => ({
        id: String(choice.id ?? choice.title ?? `${gi}-${ci}`), label: String(choice.title ?? String.fromCharCode(65 + ci)), bodyHtml: sanitizeHtml(choice.body), order: Number(choice.order ?? ci + 1)
      }))
    }));
    const questionId = id(subject, String(data.slug ?? record.slug)); const answer = answerFor(data, questionId, String(data.type ?? "Practice")); const correctLabels = sourceAnswer(data);
    const allChoices = groups.flatMap((group: any) => group.choices);
    const correctChoiceIds = data.type === "Quantitative Comparison" ? (answer && "choice" in answer ? [answer.choice] : []) : allChoices.filter((choice: any) => correctLabels.includes(choice.label) || correctLabels.includes(choice.id)).map((choice: any) => choice.id);
    const videoId = vimeoId(data.solution_video?.url ?? data.solution_video?.embed_code);
    const validVideo = videoId && existsSync(join(solutionDir, `${videoId}.mp4`)) ? videoId : null;
    return {
      id: questionId, subject, type: String(data.type ?? "Practice"),
      difficulty: ["Easy", "Medium", "Hard"].includes(data.dynamic_difficulty) ? data.dynamic_difficulty : (["Easy", "Medium", "Hard"].includes(data.difficulty) ? data.difficulty : null),
      title: String(data.title ?? data.browser_title ?? "Untitled question"), promptHtml: sanitizeHtml(data.body), choiceGroups: groups,
      correctChoiceIds, answer, scoring: { requiredCorrect: correctChoiceIds.length, total: correctChoiceIds.length },
      solution: { html: sanitizeHtml(data.solution_video?.body ?? data.solution?.body ?? ""), videoId: validVideo },
      metadata: { source: typeof data.source === "string" && data.source ? data.source : null, acceptanceRate: typeof data.acceptance === "number" ? data.acceptance : null }
    };
  });
}

function buildVideos(subject: Subject): { catalog: VideoCatalog; media: Record<string, string> } {
  const base = subject === "quant" ? "GRE Quant" : "GRE Verbal";
  const source = JSON.parse(readFileSync(join(root, base, "info.json"), "utf8"));
  const index = makeMediaIndex(subject); const media: Record<string, string> = {};
  const catalog: VideoCatalog = { subject, title: String(source.title), categories: source.categories.map((category: any, ci: number) => {
    const categoryId = `${subject}:category:${category.slug ?? ci}`;
    return { id: categoryId, title: String(category.title), descriptionHtml: sanitizeHtml(category.description), videos: (category.contents ?? []).flatMap((video: any, vi: number) => {
      const videoId = `${subject}:video:${video.slug ?? `${ci}-${vi}`}`;
      const mediaId = `${subject}-${hash(`${category.title}/${video.title}`)}`;
      try { media[mediaId] = findCourseMedia(subject, category.title, video.title, index); }
      catch (error) { if (!allowMissingMedia) throw error; console.warn(`Omitting unavailable lesson: ${(error as Error).message}`); return []; }
      return [{ id: videoId, title: String(video.title), descriptionHtml: sanitizeHtml(video.description), durationSeconds: Number.isFinite(video.video?.duration) ? video.video.duration : null, mediaId, categoryId, order: vi }];
    }) };
  }) };
  return { catalog, media };
}

function writeGzip(name: string, value: unknown) { writeFileSync(join(output, name), gzipSync(JSON.stringify(value))); }
mkdirSync(output, { recursive: true });
const media: Record<string, string> = {};
for (const subject of ["quant", "verbal"] as const) {
  const questions = buildQuestions(subject); const questionEnvelope = { schemaVersion: 1 as const, contentVersion: hash(questions), generatedAt: new Date().toISOString(), subject, data: questions };
  QuestionCatalogSchema.parse(questionEnvelope); writeGzip(`questions-${subject}.json.gz`, questionEnvelope);
  const result = buildVideos(subject); Object.assign(media, result.media);
  const videoEnvelope = { schemaVersion: 1 as const, contentVersion: hash(result.catalog), generatedAt: new Date().toISOString(), subject, data: result.catalog };
  VideoCatalogEnvelopeSchema.parse(videoEnvelope); writeGzip(`videos-${subject}.json.gz`, videoEnvelope);
}
writeFileSync(join(output, "media-map.json"), JSON.stringify(media, null, 2));
console.log(`Generated catalogs and ${Object.keys(media).length} local media mappings in ${relative(root, output)}`);
