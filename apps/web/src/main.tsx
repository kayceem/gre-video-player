import {
    StrictMode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createRoot } from "react-dom/client";
import katex from "katex";
import {
    BookOpen,
    Brain,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleUserRound,
    Download,
    FastForward,
    Gauge,
    House,
    LogOut,
    Maximize,
    Minimize,
    Monitor,
    Moon,
    Pause,
    Play,
    RefreshCw,
    Rewind,
    Search,
    SkipBack,
    SkipForward,
    SlidersHorizontal,
    Sparkles,
    Sun,
    Target,
    Trash2,
    Undo2,
    WifiOff,
    X,
} from "lucide-react";
import type {
    Question,
    QuestionCatalog,
    Subject,
    VideoCatalogEnvelope,
} from "@gre/contracts";
import type { MountainData, MountainItem } from "./mountain-types";
import "katex/dist/katex.min.css";
import "video.js/dist/video-js.css";
import "./style.css";
import { Memorize } from "./Memorize";
import {
    ReactSketchCanvas,
    type ReactSketchCanvasRef,
} from "react-sketch-canvas";

type Catalogs = {
    questions: Record<Subject, Question[]>;
    videos: Record<Subject, VideoCatalogEnvelope["data"]>;
};
type Bootstrap = {
    videos: Array<{
        videoId: string;
        positionSeconds: number;
        watched: number;
        completed: number;
    }>;
    attempts: Array<{
        questionId: string;
        correct: number;
        score: number;
        submittedAt: string;
    }>;
    bookmarks: Array<{ questionId: string }>;
    memorizeProgress: Array<{
        source: "verbal" | "quant" | "quant-overwhelmed";
        groupSlug: string;
        itemSlug: string;
        status: "G" | "R";
        updatedAt?: string;
    }>;
};
const initialCatalogs: Catalogs = {
    questions: { quant: [], verbal: [] },
    videos: {
        quant: { subject: "quant", title: "GRE Quant", categories: [] },
        verbal: { subject: "verbal", title: "GRE Verbal", categories: [] },
    },
};
class ApiRequestError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "ApiRequestError";
    }
}
const api = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
        ...options,
    });
    if (!response.ok) {
        throw new ApiRequestError(
            (await response.json().catch(() => null))?.error ??
                "Request failed",
            response.status
        );
    }
    return response.status === 204 ? null : response.json();
};
const getParam = (key: string, fallback: string) =>
    new URLSearchParams(location.search).get(key) ?? fallback;
const setParams = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams(location.search);
    Object.entries(next).forEach(([key, value]) =>
        value ? query.set(key, value) : query.delete(key)
    );
    history.pushState({}, "", `${location.pathname}?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
};
type Theme = "auto" | "light" | "dark";
const themeKey = "gre-theme";
const readTheme = (): Theme => {
    try {
        const value = localStorage.getItem(themeKey);
        return value === "light" || value === "dark" || value === "auto"
            ? value
            : "auto";
    } catch {
        return "auto";
    }
};
document.documentElement.setAttribute("data-theme", readTheme());

function openStore(name: string) {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("gre-study-desk", 1);
        r.onupgradeneeded = () => {
            r.result.createObjectStore("catalogs");
            r.result.createObjectStore("mutations", { keyPath: "id" });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function storeGet<T>(key: string): Promise<T | undefined> {
    const db = await openStore("catalogs");
    return new Promise((resolve, reject) => {
        const r = db.transaction("catalogs").objectStore("catalogs").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
async function storeSet(key: string, value: unknown) {
    const db = await openStore("catalogs");
    return new Promise<void>((resolve, reject) => {
        const r = db
            .transaction("catalogs", "readwrite")
            .objectStore("catalogs")
            .put(value, key);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
    });
}
async function queueMutation(mutation: {
    url: string;
    method: string;
    body: unknown;
}) {
    const db = await openStore("mutations");
    return new Promise<void>((resolve, reject) => {
        const r = db
            .transaction("mutations", "readwrite")
            .objectStore("mutations")
            .put({ id: newIdempotencyKey(), ...mutation });
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
    });
}
type FlushQueueResult = {
    synced: number;
    remaining: number;
};
let activeQueueFlush: Promise<FlushQueueResult> | null = null;

async function countQueuedMutations(db: IDBDatabase) {
    return new Promise<number>((resolve, reject) => {
        const r = db.transaction("mutations").objectStore("mutations").count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

function flushQueue() {
    if (activeQueueFlush) return activeQueueFlush;

    activeQueueFlush = (async (): Promise<FlushQueueResult> => {
        const db = await openStore("mutations");
        const entries = await new Promise<any[]>((resolve, reject) => {
            const r = db
                .transaction("mutations")
                .objectStore("mutations")
                .getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        let synced = 0;
        for (const e of entries) {
            try {
                await api(e.url, {
                    method: e.method,
                    body: JSON.stringify(e.body),
                });
                await new Promise<void>((resolve, reject) => {
                    const r = db
                        .transaction("mutations", "readwrite")
                        .objectStore("mutations")
                        .delete(e.id);
                    r.onsuccess = () => resolve();
                    r.onerror = () => reject(r.error);
                });
                synced += 1;
            } catch {
                break;
            }
        }
        return { synced, remaining: await countQueuedMutations(db) };
    })();

    const result = activeQueueFlush.finally(() => {
        activeQueueFlush = null;
    });
    activeQueueFlush = result;
    return result;
}
async function loadCatalogs(): Promise<Catalogs> {
    const results = await Promise.all(
        (["videos", "questions"] as const).flatMap((kind) =>
            (["quant", "verbal"] as Subject[]).map(async (subject) => {
                const key = `${kind}-${subject}`;
                try {
                    const data = await api(`/api/catalog/${kind}/${subject}`);
                    await storeSet(key, data);
                    return [kind, subject, data] as const;
                } catch {
                    const cached = await storeGet<any>(key);
                    if (!cached)
                        throw new Error(
                            "Course catalog is not available yet. Connect once to download it."
                        );
                    return [kind, subject, cached] as const;
                }
            })
        )
    );
    const result = structuredClone(initialCatalogs);
    for (const [kind, subject, envelope] of results) {
        if (kind === "questions")
            result.questions[subject] = (envelope as QuestionCatalog).data;
        else result.videos[subject] = (envelope as VideoCatalogEnvelope).data;
    }
    return result;
}
const escapeHtml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
const decodeMathEntities = (value: string) => {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = value;
    return decoder.value;
};
export function renderMath(value: string, escapeText = false) {
    const expression =
        /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\.|[^\\$\n])+?)(?<!\\)\$/g;
    let output = "",
        cursor = 0,
        match: RegExpExecArray | null;
    while ((match = expression.exec(value))) {
        output += escapeText
            ? escapeHtml(value.slice(cursor, match.index))
            : value.slice(cursor, match.index);
        const math = decodeMathEntities(
            match[1] ?? match[2] ?? match[3] ?? match[4] ?? ""
        );
        output += katex.renderToString(math, {
            displayMode: Boolean(match[1] ?? match[2]),
            throwOnError: false,
        });
        cursor = match.index + match[0].length;
    }
    output += escapeText
        ? escapeHtml(value.slice(cursor))
        : value.slice(cursor);
    return output;
}
export function Html({ value }: { value: string }) {
    return (
        <div
            className="rich-text"
            dangerouslySetInnerHTML={{ __html: renderMath(value) }}
        />
    );
}

type VocabularyIndex = {
    byTerm: Map<string, MountainItem>;
    bySlug: Map<string, MountainItem>;
};
const emptyVocabularyIndex = (): VocabularyIndex => ({
    byTerm: new Map(),
    bySlug: new Map(),
});
const normalizeVocabularyTerm = (value: string) =>
    value
        .trim()
        .toLocaleLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ");
const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type VocabularyPartOfSpeech = "verb" | "noun" | "adjective" | "adverb";

const irregularVerbForms: Record<string, string[]> = {
    abide: ["abides", "abode", "abided", "abiding"],
    be: ["am", "is", "are", "was", "were", "been", "being"],
    become: ["becomes", "became", "become", "becoming"],
    begin: ["begins", "began", "begun", "beginning"],
    break: ["breaks", "broke", "broken", "breaking"],
    bring: ["brings", "brought", "bringing"],
    build: ["builds", "built", "building"],
    buy: ["buys", "bought", "buying"],
    catch: ["catches", "caught", "catching"],
    choose: ["chooses", "chose", "chosen", "choosing"],
    come: ["comes", "came", "coming"],
    do: ["does", "did", "done", "doing"],
    draw: ["draws", "drew", "drawn", "drawing"],
    drink: ["drinks", "drank", "drunk", "drinking"],
    drive: ["drives", "drove", "driven", "driving"],
    eat: ["eats", "ate", "eaten", "eating"],
    fall: ["falls", "fell", "fallen", "falling"],
    feel: ["feels", "felt", "feeling"],
    fight: ["fights", "fought", "fighting"],
    find: ["finds", "found", "finding"],
    fly: ["flies", "flew", "flown", "flying"],
    forbear: ["forbears", "forbore", "forborne", "forbearing"],
    forget: ["forgets", "forgot", "forgotten", "forgetting"],
    forgive: ["forgives", "forgave", "forgiven", "forgiving"],
    forsake: ["forsakes", "forsook", "forsaken", "forsaking"],
    freeze: ["freezes", "froze", "frozen", "freezing"],
    get: ["gets", "got", "gotten", "getting"],
    give: ["gives", "gave", "given", "giving"],
    go: ["goes", "went", "gone", "going"],
    grow: ["grows", "grew", "grown", "growing"],
    have: ["has", "had", "having"],
    hear: ["hears", "heard", "hearing"],
    hide: ["hides", "hid", "hidden", "hiding"],
    hold: ["holds", "held", "holding"],
    keep: ["keeps", "kept", "keeping"],
    know: ["knows", "knew", "known", "knowing"],
    lead: ["leads", "led", "leading"],
    leave: ["leaves", "left", "leaving"],
    lend: ["lends", "lent", "lending"],
    lie: ["lies", "lay", "lain", "lying"],
    lose: ["loses", "lost", "losing"],
    make: ["makes", "made", "making"],
    mean: ["means", "meant", "meaning"],
    meet: ["meets", "met", "meeting"],
    pay: ["pays", "paid", "paying"],
    put: ["puts", "putting"],
    read: ["reads", "read", "reading"],
    ride: ["rides", "rode", "ridden", "riding"],
    rise: ["rises", "rose", "risen", "rising"],
    run: ["runs", "ran", "running"],
    say: ["says", "said", "saying"],
    see: ["sees", "saw", "seen", "seeing"],
    sell: ["sells", "sold", "selling"],
    send: ["sends", "sent", "sending"],
    set: ["sets", "setting"],
    shake: ["shakes", "shook", "shaken", "shaking"],
    sing: ["sings", "sang", "sung", "singing"],
    sink: ["sinks", "sank", "sunk", "sinking"],
    sit: ["sits", "sat", "sitting"],
    sleep: ["sleeps", "slept", "sleeping"],
    speak: ["speaks", "spoke", "spoken", "speaking"],
    spend: ["spends", "spent", "spending"],
    stand: ["stands", "stood", "standing"],
    steal: ["steals", "stole", "stolen", "stealing"],
    swim: ["swims", "swam", "swum", "swimming"],
    take: ["takes", "took", "taken", "taking"],
    teach: ["teaches", "taught", "teaching"],
    tear: ["tears", "tore", "torn", "tearing"],
    tell: ["tells", "told", "telling"],
    think: ["thinks", "thought", "thinking"],
    throw: ["throws", "threw", "thrown", "throwing"],
    understand: ["understands", "understood", "understanding"],
    wake: ["wakes", "woke", "woken", "waking"],
    wear: ["wears", "wore", "worn", "wearing"],
    win: ["wins", "won", "winning"],
    withstand: ["withstands", "withstood", "withstanding"],
    write: ["writes", "wrote", "written", "writing"],
};

const irregularNounForms: Record<string, string[]> = {
    analysis: ["analyses"],
    axis: ["axes"],
    basis: ["bases"],
    cactus: ["cacti", "cactuses"],
    crisis: ["crises"],
    diagnosis: ["diagnoses"],
    emphasis: ["emphases"],
    hypothesis: ["hypotheses"],
    index: ["indices", "indexes"],
    oasis: ["oases"],
    parenthesis: ["parentheses"],
    phenomenon: ["phenomena"],
    stimulus: ["stimuli", "stimuluses"],
    synopsis: ["synopses"],
    thesis: ["theses"],
    criterion: ["criteria"],
    child: ["children"],
    man: ["men"],
    person: ["people"],
    woman: ["women"],
};

const shouldDoubleFinalConsonant = (word: string) => {
    if (
        new Set([
            "abet",
            "begin",
            "commit",
            "control",
            "defer",
            "equip",
            "excel",
            "forget",
            "occur",
            "omit",
            "outstrip",
            "permit",
            "prefer",
            "propel",
            "refer",
            "regret",
            "submit",
            "transmit",
            "travel",
        ]).has(word)
    )
        return true;
    return (
        word.length <= 5 &&
        /[^aeiou][aeiou][^aeiouwxy]$/i.test(word) &&
        !/(.)\1$/i.test(word)
    );
};

const regularVerbForms = (word: string) => {
    const forms = new Set<string>();
    if (/[^aeiou]y$/i.test(word)) forms.add(`${word.slice(0, -1)}ies`);
    else if (/(s|x|z|ch|sh|o)$/i.test(word)) forms.add(`${word}es`);
    else forms.add(`${word}s`);

    if (/[^aeiou]y$/i.test(word)) forms.add(`${word.slice(0, -1)}ied`);
    else if (word.endsWith("e")) forms.add(`${word}d`);
    else if (shouldDoubleFinalConsonant(word))
        forms.add(`${word}${word.at(-1)}ed`);
    else forms.add(`${word}ed`);

    if (word.endsWith("ie")) forms.add(`${word.slice(0, -2)}ying`);
    else if (word.endsWith("e") && !word.endsWith("ee"))
        forms.add(`${word.slice(0, -1)}ing`);
    else if (shouldDoubleFinalConsonant(word))
        forms.add(`${word}${word.at(-1)}ing`);
    else forms.add(`${word}ing`);
    return forms;
};

const regularNounForms = (word: string) => {
    if (/[^aeiou]y$/i.test(word)) return [`${word.slice(0, -1)}ies`];
    if (/(s|x|z|ch|sh)$/i.test(word)) return [`${word}es`];
    if (/[^f]fe?$/i.test(word))
        return [`${word.slice(0, -1)}ves`, `${word}s`];
    return [`${word}s`];
};

const adjectiveAdverbForm = (word: string) => {
    if (word.endsWith("y")) return `${word.slice(0, -1)}ily`;
    if (word.endsWith("ic")) return `${word}ally`;
    if (word.endsWith("e")) return `${word.slice(0, -1)}ly`;
    return `${word}ly`;
};

const adjectiveComparisonForms = (word: string) => {
    if (
        word.length > 7 ||
        /(ous|ful|ive|al|ic|ent|ant|able|ible|ish|less)$/i.test(word)
    )
        return [];
    if (/[^aeiou]y$/i.test(word))
        return [`${word.slice(0, -1)}ier`, `${word.slice(0, -1)}iest`];
    if (word.endsWith("e")) return [`${word}r`, `${word}st`];
    if (shouldDoubleFinalConsonant(word))
        return [
            `${word}${word.at(-1)}er`,
            `${word}${word.at(-1)}est`,
        ];
    return [`${word}er`, `${word}est`];
};

function vocabularyPartsOfSpeech(item: MountainItem) {
    const parts = new Set<VocabularyPartOfSpeech>();
    for (const match of item.description.matchAll(
        /\b(verb|noun|adjective|adverb)\s*:/gi
    )) {
        parts.add(match[1].toLowerCase() as VocabularyPartOfSpeech);
    }
    return parts;
}

function vocabularyInflectedForms(
    term: string,
    parts: Set<VocabularyPartOfSpeech>
) {
    const forms = new Set<string>([term]);
    const head = term.split(" ")[0];
    const withHead = (form: string) =>
        term === head ? form : `${form}${term.slice(head.length)}`;
    const addForms = (values: string[]) =>
        values.forEach((value) => forms.add(normalizeVocabularyTerm(withHead(value))));

    if (parts.has("verb")) {
        const irregular = irregularVerbForms[head];
        addForms(irregular ?? [...regularVerbForms(head)]);
    }
    if (parts.has("noun")) {
        const irregular = irregularNounForms[head];
        addForms(irregular ?? regularNounForms(head));
    }
    if (parts.has("adjective")) {
        addForms([adjectiveAdverbForm(head)]);
        addForms(adjectiveComparisonForms(head));
    }
    return forms;
}

function createVocabularyIndex(data: MountainData): VocabularyIndex {
    const byTerm = new Map<string, MountainItem>();
    const bySlug = new Map<string, MountainItem>();
    const items = data.mountain_categories.flatMap(
        (category) => category.mountain_contents
    );
    items.forEach((item) => {
        const term = normalizeVocabularyTerm(item.title);
        if (!byTerm.has(term)) byTerm.set(term, item);
        bySlug.set(item.slug, item);
    });
    items.forEach((item) => {
        const term = normalizeVocabularyTerm(item.title);
        vocabularyInflectedForms(term, vocabularyPartsOfSpeech(item)).forEach(
            (form) => {
                if (!byTerm.has(form)) byTerm.set(form, item);
            }
        );
    });
    return { byTerm, bySlug };
}
function decorateVocabularyHtml(value: string, vocabulary: VocabularyIndex) {
    const html = renderMath(value);
    if (!vocabulary.byTerm.size || typeof DOMParser === "undefined") return html;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const terms = [...vocabulary.byTerm.keys()]
        .sort((a, b) => b.length - a.length)
        .map((term) => escapeRegExp(term).replace(/ /g, "\\s+"));
    if (!terms.length) return html;
    const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])(${terms.join("|")})(?![\\p{L}\\p{N}])`,
        "giu"
    );
    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
        const parent = textNode.parentElement;
        if (
            !parent ||
            parent.closest(".katex, script, style, [data-vocab-slug]")
        )
            return;
        const text = textNode.nodeValue ?? "";
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        let changed = false;
        const fragment = document.createDocumentFragment();
        while ((match = pattern.exec(text))) {
            const prefix = match[1] ?? "";
            const item = vocabulary.byTerm.get(
                normalizeVocabularyTerm(match[2] ?? "")
            );
            if (!item) continue;
            changed = true;
            if (match.index > lastIndex) {
                fragment.append(text.slice(lastIndex, match.index));
            }
            if (prefix) fragment.append(prefix);
            const word = document.createElement("span");
            word.className = "vocab-word";
            word.dataset.vocabSlug = item.slug;
            word.textContent = match[2] ?? "";
            fragment.append(word);
            lastIndex = match.index + match[0].length;
        }
        if (!changed) return;
        if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
        textNode.replaceWith(fragment);
    });
    return wrapper.innerHTML;
}
function VocabularyHtml({
    value,
    vocabulary,
    onWordClick,
    onWordDoubleClick,
}: {
    value: string;
    vocabulary: VocabularyIndex;
    onWordClick?: (item: MountainItem, anchor: HTMLElement) => void;
    onWordDoubleClick?: (item: MountainItem, anchor: HTMLElement) => void;
}) {
    const html = useMemo(
        () => decorateVocabularyHtml(value, vocabulary),
        [value, vocabulary]
    );
    const handleWordEvent = (
        event: React.MouseEvent<HTMLDivElement>,
        callback?: (item: MountainItem, anchor: HTMLElement) => void
    ) => {
        if (!callback) return;
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest<HTMLElement>("[data-vocab-slug]");
        if (!anchor || !event.currentTarget.contains(anchor)) return;
        const item = vocabulary.bySlug.get(anchor.dataset.vocabSlug ?? "");
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        callback(item, anchor);
    };
    return (
        <div
            className="rich-text vocabulary-rich-text"
            onClick={(event) => handleWordEvent(event, onWordClick)}
            onDoubleClick={(event) =>
                handleWordEvent(event, onWordDoubleClick)
            }
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
function MathText({ value }: { value: string }) {
    return (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value, true) }} />
    );
}
function pct(done: number, total: number) {
    return total ? Math.round((done / total) * 100) : 0;
}
const skipVideo = (
    element: HTMLVideoElement | null | undefined,
    amount: number
) => {
    if (!element) return;
    const duration =
        Number.isFinite(element.duration) && element.duration > 0
            ? element.duration
            : Number.MAX_SAFE_INTEGER;
    element.currentTime = Math.max(
        0,
        Math.min(duration, element.currentTime + amount)
    );
};
type VideoSeekTarget = "lesson" | "solution";
type VideoSeekFeedback = {
    target: VideoSeekTarget;
    amount: number;
};
const videoSeekEvent = "gre-video-seek";
const notifyVideoSeek = (target: VideoSeekTarget, amount: number) => {
    window.dispatchEvent(
        new CustomEvent<VideoSeekFeedback>(videoSeekEvent, {
            detail: { target, amount },
        })
    );
};
function useVideoSeekFeedback(target: VideoSeekTarget) {
    const [feedback, setFeedback] = useState<{
        direction: "forward" | "backward";
        seconds: number;
    } | null>(null);
    const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const handleSeekFeedback = (event: Event) => {
            const detail = (event as CustomEvent<VideoSeekFeedback>).detail;
            if (!detail || detail.target !== target || !detail.amount) return;
            const direction = detail.amount > 0 ? "forward" : "backward";
            setFeedback((current) => ({
                direction,
                seconds:
                    current?.direction === direction
                        ? current.seconds + Math.abs(detail.amount)
                        : Math.abs(detail.amount),
            }));
            if (feedbackTimerRef.current)
                clearTimeout(feedbackTimerRef.current);
            feedbackTimerRef.current = setTimeout(() => {
                setFeedback(null);
                feedbackTimerRef.current = null;
            }, 650);
        };
        window.addEventListener(videoSeekEvent, handleSeekFeedback);
        return () => {
            window.removeEventListener(videoSeekEvent, handleSeekFeedback);
            if (feedbackTimerRef.current) {
                clearTimeout(feedbackTimerRef.current);
                feedbackTimerRef.current = null;
            }
        };
    }, [target]);
    return feedback;
}
const autoNextKey = "gre-auto-next";
const autoPlayKey = "gre-auto-play";
const readBool = (key: string, fallback: boolean) => {
    try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : v === "true";
    } catch {
        return fallback;
    }
};
const storeBool = (key: string, value: boolean) => {
    try {
        localStorage.setItem(key, String(value));
    } catch {}
};
const newIdempotencyKey = () => {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const hex = (length: number) =>
        Array.from({ length }, () =>
            Math.floor(Math.random() * 16).toString(16)
        ).join("");
    return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
};

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
};

function usePwa() {
    const [installEvent, setInstallEvent] =
        useState<BeforeInstallPromptEvent | null>(null);
    const [updateReady, setUpdateReady] = useState(false);
    const [dismissedInstall, setDismissedInstall] = useState(() => {
        try {
            return localStorage.getItem("gre-install-dismissed") === "true";
        } catch {
            return false;
        }
    });
    useEffect(() => {
        const onPrompt = (event: Event) => {
            event.preventDefault();
            setInstallEvent(event as BeforeInstallPromptEvent);
        };
        addEventListener("beforeinstallprompt", onPrompt as EventListener);
        return () =>
            removeEventListener(
                "beforeinstallprompt",
                onPrompt as EventListener
            );
    }, []);
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        let registration: ServiceWorkerRegistration | undefined;
        navigator.serviceWorker
            .register("/sw.js")
            .then((reg) => {
                registration = reg;
                if (reg.waiting) setUpdateReady(true);
                reg.addEventListener("updatefound", () => {
                    reg.installing?.addEventListener("statechange", () => {
                        if (
                            reg.installing?.state === "installed" &&
                            navigator.serviceWorker.controller
                        )
                            setUpdateReady(true);
                    });
                });
            })
            .catch(() => {});
        const onController = () => setUpdateReady(false);
        navigator.serviceWorker.addEventListener(
            "controllerchange",
            onController
        );
        return () => {
            navigator.serviceWorker.removeEventListener(
                "controllerchange",
                onController
            );
            void registration;
        };
    }, []);
    const install = useCallback(async () => {
        if (!installEvent) return false;
        await installEvent.prompt();
        const choice = await installEvent.userChoice.catch(() => null);
        setInstallEvent(null);
        return choice?.outcome === "accepted";
    }, [installEvent]);
    const dismissInstall = useCallback(() => {
        setDismissedInstall(true);
        try {
            localStorage.setItem("gre-install-dismissed", "true");
        } catch {}
    }, []);
    const applyUpdate = useCallback(() => {
        navigator.serviceWorker.getRegistration().then((reg) => {
            reg?.waiting?.postMessage("SKIP_WAITING");
        });
        setUpdateReady(false);
    }, []);
    const isStandalone = useMemo(() => {
        try {
            return (
                matchMedia("(display-mode: standalone)").matches ||
                (navigator as any).standalone === true
            );
        } catch {
            return false;
        }
    }, []);
    const showInstall =
        Boolean(installEvent) && !dismissedInstall && !isStandalone;
    return {
        installEvent,
        install,
        dismissInstall,
        updateReady,
        applyUpdate,
        showInstall,
        isStandalone,
    };
}

function InstallBanner({
    visible,
    onInstall,
    onDismiss,
}: {
    visible: boolean;
    onInstall: () => void;
    onDismiss: () => void;
}) {
    if (!visible) return null;
    return (
        <div className="pwa-banner" role="status">
            <span className="pwa-banner-icon" aria-hidden="true">
                <Download size={18} />
            </span>
            <p>
                <strong>Install GRE Study Desk</strong>
                <span>Quick access + offline lessons on your home screen.</span>
            </p>
            <button className="pwa-install" onClick={onInstall}>
                Install
            </button>
            <button
                className="pwa-dismiss"
                onClick={onDismiss}
                aria-label="Dismiss install prompt"
            >
                <X size={16} />
            </button>
        </div>
    );
}

function UpdateToast({
    visible,
    onUpdate,
}: {
    visible: boolean;
    onUpdate: () => void;
}) {
    if (!visible) return null;
    return (
        <div className="pwa-update" role="status">
            <RefreshCw size={16} />
            <span>A new version is ready.</span>
            <button onClick={onUpdate}>Reload to update</button>
        </div>
    );
}

function ScratchPad({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const canvasRef = useRef<ReactSketchCanvasRef>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        const backgroundElements = backdropRef.current?.parentElement
            ? Array.from(backdropRef.current.parentElement.children).filter(
                  (element) => element !== backdropRef.current
              )
            : [];
        const previousInert = backgroundElements.map((element) => ({
            element,
            inert: (element as HTMLElement & { inert?: boolean }).inert ?? false,
        }));
        document.body.style.overflow = "hidden";
        backgroundElements.forEach((element) => {
            (element as HTMLElement & { inert: boolean }).inert = true;
        });
        closeButtonRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            previousInert.forEach(({ element, inert }) => {
                (element as HTMLElement & { inert: boolean }).inert = inert;
            });
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if (key === "c") {
                event.preventDefault();
                canvasRef.current?.clearCanvas();
            } else if (key === "z") {
                event.preventDefault();
                canvasRef.current?.undo();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open]);

    return (
        <div
            ref={backdropRef}
            className={`scratch-pad-backdrop ${open ? "is-open" : ""}`}
            role={open ? "dialog" : undefined}
            aria-modal={open ? "true" : undefined}
            aria-hidden={!open}
            aria-label="Scratch pad"
        >
            <ReactSketchCanvas
                ref={canvasRef}
                className="scratch-pad-canvas"
                width="100%"
                height="100%"
                strokeColor="#ef4444"
                strokeWidth={4}
                canvasColor="transparent"
                style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 1,
                }}
                svgStyle={{
                    width: "100%",
                    height: "100%",
                    touchAction: "none",
                }}
            />
            <div className="scratch-pad-toolbar">
                <div className="scratch-pad-actions">
                    <button
                        type="button"
                        className="scratch-pad-action"
                        onClick={() => canvasRef.current?.undo()}
                        title="Undo last stroke (Z)"
                    >
                        <Undo2 size={17} />
                        <span>Undo</span>
                        <kbd>Z</kbd>
                    </button>
                    <button
                        type="button"
                        className="scratch-pad-action"
                        onClick={() => canvasRef.current?.clearCanvas()}
                        title="Clear scratch pad (C)"
                    >
                        <Trash2 size={17} />
                        <span>Clear</span>
                        <kbd>C</kbd>
                    </button>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        className="scratch-pad-action scratch-pad-close"
                        onClick={onClose}
                        title="Close scratch pad (Q)"
                    >
                        <X size={17} />
                        <span>Close</span>
                        <kbd>Q</kbd>
                    </button>
                </div>
            </div>
        </div>
    );
}

class GreCalculatorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GreCalculatorError";
    }
}

const evaluateGreExpression = (expression: string) => {
    let cursor = 0;
    const skipWhitespace = () => {
        while (/\s/.test(expression[cursor] ?? "")) cursor++;
    };
    const parseExpression = (): number => {
        let value = parseTerm();
        while (true) {
            skipWhitespace();
            const operator = expression[cursor];
            if (operator !== "+" && operator !== "-") return value;
            cursor++;
            const right = parseTerm();
            value = operator === "+" ? value + right : value - right;
        }
    };
    const parseTerm = (): number => {
        let value = parseUnary();
        while (true) {
            skipWhitespace();
            const operator = expression[cursor];
            if (operator !== "*" && operator !== "/") return value;
            cursor++;
            const right = parseUnary();
            if (operator === "/" && right === 0)
                throw new GreCalculatorError("Cannot divide by zero.");
            value = operator === "*" ? value * right : value / right;
        }
    };
    const parseUnary = (): number => {
        skipWhitespace();
        if (expression[cursor] === "+") {
            cursor++;
            return parseUnary();
        }
        if (expression[cursor] === "-") {
            cursor++;
            return -parseUnary();
        }
        return parsePrimary();
    };
    const parsePrimary = (): number => {
        skipWhitespace();
        if (expression[cursor] === "(") {
            cursor++;
            const value = parseExpression();
            skipWhitespace();
            if (expression[cursor] !== ")")
                throw new GreCalculatorError("Invalid expression.");
            cursor++;
            return value;
        }
        const start = cursor;
        let hasDigit = false;
        while (/\d/.test(expression[cursor] ?? "")) {
            hasDigit = true;
            cursor++;
        }
        if (expression[cursor] === ".") {
            cursor++;
            while (/\d/.test(expression[cursor] ?? "")) {
                hasDigit = true;
                cursor++;
            }
        }
        if (!hasDigit) throw new GreCalculatorError("Invalid expression.");
        return Number(expression.slice(start, cursor));
    };
    const value = parseExpression();
    skipWhitespace();
    if (cursor !== expression.length)
        throw new GreCalculatorError("Invalid expression.");
    if (!Number.isFinite(value))
        throw new GreCalculatorError("The result is too large.");
    return value;
};

const formatGreNumber = (value: number) => {
    if (!Number.isFinite(value))
        throw new GreCalculatorError("The result is too large.");
    return String(value);
};

function GreCalculator({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const panelRef = useRef<HTMLElement>(null);
    const displayRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        offsetX: number;
        offsetY: number;
    } | null>(null);
    const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [position, setPosition] = useState(() => ({
        x: Math.max(12, Math.round(window.innerWidth / 2 - 150)),
        y: 84,
    }));
    const [result, setResult] = useState("");
    const [memory, setMemory] = useState(0);
    const [memoryHasValue, setMemoryHasValue] = useState(false);
    const [memoryRecalledForOperand, setMemoryRecalledForOperand] = useState(false);
    const [decimalDisabled, setDecimalDisabled] = useState(false);
    const [message, setMessage] = useState("");
    const [size, setSize] = useState<"small" | "medium" | "large">("medium");

    // The GRE calculator display shows the number currently being entered,
    // rather than the whole expression. Keep a unary minus with that number.
    const displayValue = (() => {
        if (result === "Error") return result;
        let end = result.length;
        while (
            end > 0 &&
            (["+", "-", "*", "/"].includes(result[end - 1]) ||
                result[end - 1] === ")")
        )
            end--;
        let start = end;
        while (start > 0 && /[\d.]/.test(result[start - 1])) start--;
        if (
            start > 0 &&
            result[start - 1] === "-" &&
            (start === 1 || ["+", "-", "*", "/", "("].includes(result[start - 2]))
        )
            start--;
        const operand = result.slice(start, end) || "0";
        return operand.includes(".") ? operand : `${operand}.`;
    })();
    const updateResult = (next: string) => {
        setResult(next);
        const lastOperator = Math.max(
            next.lastIndexOf("+"),
            next.lastIndexOf("-"),
            next.lastIndexOf("*"),
            next.lastIndexOf("/"),
            next.lastIndexOf("(")
        );
        const operand = next.slice(lastOperator + 1);
        setDecimalDisabled(operand.includes("."));
    };
    const clearMessage = () => setMessage("");
    const showError = (error: unknown) => {
        updateResult("Error");
        setMessage(
            error instanceof GreCalculatorError
                ? error.message
                : "Invalid expression."
        );
    };
    const appendCharacter = (character: string) => {
        clearMessage();
        if (result === "Error") {
            updateResult(character);
            return;
        }
        if (character === "." && decimalDisabled) return;
        if (character === ")") {
            const unmatchedOpenParentheses = [...result].reduce(
                (total, current) =>
                    total + (current === "(" ? 1 : current === ")" ? -1 : 0),
                0
            );
            if (unmatchedOpenParentheses < 1 || !/[\d)]$/.test(result)) return;
        }
        const lastCharacter = result.slice(-1);
        const lastIsOperator = ["+", "-", "*", "/"].includes(lastCharacter);
        let currentOperandStart = result.length;
        while (
            currentOperandStart > 0 &&
            /[\d.]/.test(result[currentOperandStart - 1])
        )
            currentOperandStart--;
        let next = result;
        if (
            /^\d$/.test(character) &&
            result.slice(currentOperandStart) === "0"
        ) {
            next = result.slice(0, currentOperandStart) + character;
        } else if (character !== "." && result.endsWith(".")) {
            next += character;
        } else if (["+", "-", "*", "/"].includes(character) && lastIsOperator) {
            next = result.slice(0, -1) + character;
        } else if ((character === "/" || character === "*") && result.length === 0) {
            next = "";
        } else {
            next += character;
        }
        if (["+", "-", "*", "/", "("].includes(character))
            setMemoryRecalledForOperand(false);
        updateResult(next);
    };
    const clearEntry = () => {
        clearMessage();
        if (result === "Error") {
            updateResult("");
            return;
        }
        if (!result) return;

        // CE removes only the current number/group, preserving the expression
        // before it (for example, 12+345 becomes 12+).
        if (result.endsWith(")")) {
            let depth = 0;
            for (let index = result.length - 1; index >= 0; index--) {
                if (result[index] === ")") depth++;
                if (result[index] === "(") {
                    depth--;
                    if (depth === 0) {
                        updateResult(result.slice(0, index));
                        return;
                    }
                }
            }
        }

        let start = result.length;
        while (start > 0 && /[\d.]/.test(result[start - 1])) start--;
        if (
            start > 0 &&
            result[start - 1] === "-" &&
            (start - 1 === 0 ||
                ["+", "-", "*", "/", "("].includes(result[start - 2]))
        )
            start--;
        setMemoryRecalledForOperand(false);
        updateResult(result.slice(0, start));
    };
    const clearAll = () => {
        setMemoryRecalledForOperand(false);
        clearMessage();
        updateResult("");
    };
    const calculateResult = () => {
        try {
            updateResult(formatGreNumber(evaluateGreExpression(result)));
            setMemoryRecalledForOperand(false);
            clearMessage();
        } catch (error) {
            showError(error);
        }
    };
    const calculateSquareRoot = () => {
        try {
            const value = evaluateGreExpression(result);
            if (value < 0)
                throw new GreCalculatorError(
                    "Cannot take the square root of a negative number."
                );
            updateResult(formatGreNumber(Math.sqrt(value)));
            setMemoryRecalledForOperand(false);
            clearMessage();
        } catch (error) {
            showError(error);
        }
    };
    const toggleSign = () => {
        clearMessage();
        if (result === "Error") {
            updateResult("");
            return;
        }
        let start = result.length;
        while (start > 0 && /[\d.]/.test(result[start - 1])) start--;
        if (start === result.length) return;
        const hasUnaryMinus =
            start > 0 &&
            result[start - 1] === "-" &&
            (start === 1 || ["+", "-", "*", "/", "("].includes(result[start - 2]));
        updateResult(
            hasUnaryMinus
                ? result.slice(0, start - 1) + result.slice(start)
                : result.slice(0, start) + "-" + result.slice(start)
        );
    };
    const memoryClear = () => {
        setMemory(0);
        setMemoryHasValue(false);
        clearMessage();
    };
    const memoryRecall = () => {
        clearMessage();
        if (memoryRecalledForOperand) return;
        if (result === "Error") updateResult("");
        appendCharacter(memory.toString());
        setMemoryRecalledForOperand(true);
    };
    const memorySum = () => {
        clearMessage();
        if (result === "" || result === "Error") return;
        try {
            const value = evaluateGreExpression(result);
            setMemory((stored) => stored + value);
            setMemoryHasValue(true);
        } catch (error) {
            showError(error);
        }
    };
    const showTransferMessage = (nextMessage: string) => {
        setMessage(nextMessage);
        if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        messageTimerRef.current = setTimeout(() => {
            setMessage("");
            messageTimerRef.current = null;
        }, 2000);
    };
    const transferDisplay = async () => {
        const value = displayRef.current;
        value?.focus();
        let copied = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(displayValue);
                copied = true;
            }
        } catch {}
        if (!copied && value) {
            try {
                const range = document.createRange();
                range.selectNodeContents(value.firstElementChild ?? value);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                copied = document.execCommand("copy");
                selection?.removeAllRanges();
            } catch {}
        }
        showTransferMessage(
            copied ? "Text copied to clipboard!" : "Unable to copy display text."
        );
    };
    const handleKeyDown = (event: KeyboardEvent) => {
        if (!open) return;
        const key = event.key;
        if (key === "Escape") {
            event.preventDefault();
            onClose();
        } else if (
            /^\d$/.test(key) ||
            [".", "+", "-", "*", "/", "(", ")"].includes(key)
        ) {
            event.preventDefault();
            appendCharacter(key);
        } else if (key === "Enter" || key === "=") {
            event.preventDefault();
            calculateResult();
        } else if (
            key.toLowerCase() === "c" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
        ) {
            event.preventDefault();
            clearAll();
        } else if (
            key.toLowerCase() === "v" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
        ) {
            event.preventDefault();
            setSize((current) =>
                current === "small"
                    ? "medium"
                    : current === "medium"
                      ? "large"
                      : "small"
            );
        }
    };
    useEffect(() => {
        if (!open) return;
        window.addEventListener("keydown", handleKeyDown);
        const focusDisplay = () => displayRef.current?.focus();
        const keepInViewport = () => {
            const panel = panelRef.current;
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            setPosition((current) => {
                const next = {
                    x: Math.max(8, Math.min(current.x, window.innerWidth - rect.width - 8)),
                    y: Math.max(8, Math.min(current.y, window.innerHeight - rect.height - 8)),
                };
                return next.x === current.x && next.y === current.y ? current : next;
            });
        };
        focusDisplay();
        keepInViewport();
        window.addEventListener("resize", keepInViewport);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", keepInViewport);
        };
    }, [open, result, memory, size]);
    useEffect(
        () => () => {
            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        },
        []
    );
    if (!open) return null;
    const unmatchedOpenParentheses = [...result].reduce(
        (total, current) =>
            total + (current === "(" ? 1 : current === ")" ? -1 : 0),
        0
    );
    const canCloseParenthesis =
        unmatchedOpenParentheses > 0 && /[\d)]$/.test(result);
    const button = (
        label: string,
        onClick: () => void,
        className: string,
        ariaLabel?: string,
        disabled = false
    ) => (
        <button
            type="button"
            className={className}
            onClick={onClick}
            aria-label={ariaLabel ?? label}
            disabled={disabled}
        >
            {label}
        </button>
    );
    return (
        <section
            ref={panelRef}
            className={`gre-calculator gre-calculator--${size}`}
            role="dialog"
            aria-modal="false"
            aria-label="GRE Calculator"
            style={{ left: position.x, top: position.y }}
            onPointerDown={(event) => {
                if (
                    event.button !== 0 ||
                    (event.target as HTMLElement).closest("button, input")
                )
                    return;
                const rect = panelRef.current?.getBoundingClientRect();
                if (!rect) return;
                dragRef.current = {
                    pointerId: event.pointerId,
                    offsetX: event.clientX - rect.left,
                    offsetY: event.clientY - rect.top,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (!dragRef.current || dragRef.current.pointerId !== event.pointerId)
                    return;
                const rect = panelRef.current?.getBoundingClientRect();
                if (!rect) return;
                setPosition({
                    x: Math.max(8, Math.min(window.innerWidth - rect.width - 8, event.clientX - dragRef.current.offsetX)),
                    y: Math.max(8, Math.min(window.innerHeight - rect.height - 8, event.clientY - dragRef.current.offsetY)),
                });
            }}
            onPointerUp={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) {
                    dragRef.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
            }}
            onPointerCancel={() => {
                dragRef.current = null;
            }}
        >
            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>
            <div
                ref={displayRef}
                className="gre-calculator-display"
                role="textbox"
                aria-readonly="true"
                aria-label="Calculator display"
                tabIndex={0}
            >
                {memoryHasValue && <span className="gre-calculator-memory">M</span>}
                <span>{displayValue}</span>
                <span className="gre-calculator-caret" aria-hidden="true">
                    |
                </span>
            </div>
            <div className="gre-calculator-row">
                {button("MC", memoryClear, "gre-calculator-m-buttons")}
                {button("MR", memoryRecall, "gre-calculator-m-buttons")}
                {button("M+", memorySum, "gre-calculator-m-buttons")}
                {button("(", () => appendCharacter("("), "gre-calculator-signs")}
                {button(
                    ")",
                    () => appendCharacter(")"),
                    "gre-calculator-signs",
                    undefined,
                    !canCloseParenthesis
                )}
            </div>
            <div className="gre-calculator-row">
                {button("7", () => appendCharacter("7"), "gre-calculator-number")}
                {button("8", () => appendCharacter("8"), "gre-calculator-number")}
                {button("9", () => appendCharacter("9"), "gre-calculator-number")}
                {button("÷", () => appendCharacter("/"), "gre-calculator-signs", "Divide")}
                {button("C", clearAll, "gre-calculator-clear", "Clear")}
            </div>
            <div className="gre-calculator-row">
                {button("4", () => appendCharacter("4"), "gre-calculator-number")}
                {button("5", () => appendCharacter("5"), "gre-calculator-number")}
                {button("6", () => appendCharacter("6"), "gre-calculator-number")}
                {button("x", () => appendCharacter("*"), "gre-calculator-signs", "Multiply")}
                {button("CE", clearEntry, "gre-calculator-clear", "Clear entry")}
            </div>
            <div className="gre-calculator-row">
                {button("1", () => appendCharacter("1"), "gre-calculator-number")}
                {button("2", () => appendCharacter("2"), "gre-calculator-number")}
                {button("3", () => appendCharacter("3"), "gre-calculator-number")}
                {button("-", () => appendCharacter("-"), "gre-calculator-signs", "Subtract")}
                {button("√", calculateSquareRoot, "gre-calculator-signs", "Square root")}
            </div>
            <div className="gre-calculator-row">
                {button(
                    "+/-",
                    toggleSign,
                    "gre-calculator-signs",
                    "Change sign",
                    !/[\d.]$/.test(result)
                )}
                {button("0", () => appendCharacter("0"), "gre-calculator-number")}
                <button
                    type="button"
                    className="gre-calculator-number"
                    id="gre-calculator-decimal"
                    disabled={decimalDisabled}
                    onClick={() => appendCharacter(".")}
                >
                    .
                </button>
                {button("+", () => appendCharacter("+"), "gre-calculator-signs", "Add")}
                {button("=", calculateResult, "gre-calculator-m-buttons", "Equals")}
            </div>
            <div className="gre-calculator-row gre-calculator-transfer-row">
                <input
                    type="button"
                    value="Transfer Display"
                    id="gre-calculator-display-button"
                    onClick={transferDisplay}
                />
            </div>
        </section>
    );
}

function App() {
    const [catalogs, setCatalogs] = useState<Catalogs>(initialCatalogs),
        [boot, setBoot] = useState<Bootstrap>({
            videos: [],
            attempts: [],
            bookmarks: [],
            memorizeProgress: [],
        }),
        [user, setUser] = useState<{ id: string; username: string } | null>(
            null
        ),
        [loading, setLoading] = useState(true),
        [catalogError, setCatalogError] = useState<string | null>(null),
        [notice, setNotice] = useState<
            { message: string; tone: "warning" | "success" } | null
        >(null),
        [online, setOnline] = useState(navigator.onLine),
        [theme, setTheme] = useState<Theme>(readTheme),
        [route, setRoute] = useState(
            location.pathname === "/" ? "dashboard" : location.pathname.slice(1)
        ),
        [locationVersion, setLocationVersion] = useState(0),
        [scratchPadOpen, setScratchPadOpen] = useState(false),
        [calculatorOpen, setCalculatorOpen] = useState(false);
    const pwa = usePwa();
    const rememberedRoutes = useRef({ learn: "/learn", practice: "/practice" });
    const spaceHoldRef = useRef<{
        media: HTMLVideoElement;
        previousRate: number;
        wasPaused: boolean;
        timer: ReturnType<typeof setTimeout>;
        activated: boolean;
    } | null>(null);
    const seekThrottleRef = useRef<{
        target: VideoSeekTarget;
        timestamp: number;
    } | null>(null);
    const rememberCurrentRoute = () => {
        const path = `${location.pathname}${location.search}`;
        if (
            location.pathname === "/learn" ||
            location.pathname.startsWith("/learn/")
        )
            rememberedRoutes.current.learn = path;
        if (
            location.pathname === "/practice" ||
            location.pathname.startsWith("/practice/")
        )
            rememberedRoutes.current.practice = path;
    };
    const flushAndNotify = useCallback(
        async (notifyWhenAlreadyEmpty = false) => {
            const result = await flushQueue();
            if (
                result.remaining === 0 &&
                (result.synced > 0 || notifyWhenAlreadyEmpty)
            ) {
                setNotice({
                    message: "Connected — all local progress is synced.",
                    tone: "success",
                });
            }
            return result;
        },
        []
    );
    useEffect(() => {
        const load = async () => {
            try {
                setCatalogs(await loadCatalogs());
            } catch (e: any) {
                setCatalogError(e.message);
            }
            try {
                const auth = await api("/api/auth/me");
                setUser(auth.user);
                if (auth.user) {
                    setBoot(await api("/api/me/bootstrap"));
                    await flushAndNotify();
                }
            } catch {
            } finally {
                setLoading(false);
            }
        };
        load();
        const pop = () => {
            rememberCurrentRoute();
            setRoute(
                location.pathname === "/"
                    ? "dashboard"
                    : location.pathname.slice(1)
            );
            setLocationVersion((version) => version + 1);
        };
        const on = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) flushAndNotify(true).catch(() => {});
        };
        addEventListener("popstate", pop);
        addEventListener("online", on);
        addEventListener("offline", on);
        return () => {
            removeEventListener("popstate", pop);
            removeEventListener("online", on);
            removeEventListener("offline", on);
        };
    }, [flushAndNotify]);
    useEffect(() => {
        rememberCurrentRoute();
    }, [route, locationVersion]);
    useEffect(() => {
        if (user) flushAndNotify().catch(() => {});
    }, [user, flushAndNotify]);
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(themeKey, theme);
        } catch {}
        document
            .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.setAttribute("content", theme === "dark" ? "#2a4fd0" : "#3662e3");
    }, [theme]);
    const go = (destination: string) => {
        rememberCurrentRoute();
        const target =
            destination === "learn"
                ? rememberedRoutes.current.learn
                : destination === "practice"
                ? rememberedRoutes.current.practice
                : destination === "dashboard"
                ? "/"
                : `/${destination}`;
        history.pushState({}, "", target);
        setRoute(target === "/" ? "dashboard" : target.split("?")[0].slice(1));
        setLocationVersion((version) => version + 1);
    };
    const mutate = useCallback(async (url: string, method: string, body: unknown) => {
        try {
            await api(url, { method, body: JSON.stringify(body) });
        } catch (error) {
            if (error instanceof ApiRequestError) {
                setNotice({
                    message:
                        error.status === 401
                            ? "Sign in to sync your progress across devices."
                            : error.message,
                    tone: "warning",
                });
                return;
            }
            try {
                await queueMutation({ url, method, body });
                setNotice({
                    message: navigator.onLine
                        ? "Saved on this device. It will sync when the server is reachable."
                        : "Saved on this device. It will sync when you reconnect.",
                    tone: "warning",
                });
            } catch {
                setNotice({
                    message: "Unable to save progress right now. Please try again.",
                    tone: "warning",
                });
            }
        }
    }, []);
    const handleMemorizeProgress = useCallback(
        (memorizeProgress: Bootstrap["memorizeProgress"]) => {
            setBoot((current) => ({ ...current, memorizeProgress }));
        },
        []
    );
    const allVideos = useMemo(
        () =>
            Object.values(catalogs.videos).flatMap((v) =>
                v.categories.flatMap((c) => c.videos)
            ),
        [catalogs]
    );
    useEffect(() => {
        let pending = false;
        const timer = () => {
            pending = false;
        };
        const releaseSpaceHold = () => {
            const hold = spaceHoldRef.current;
            if (!hold) return;
            clearTimeout(hold.timer);
            if (hold.activated) {
                hold.media.playbackRate = hold.previousRate;
                if (hold.wasPaused) hold.media.pause();
            } else if (hold.wasPaused) {
                hold.media.play().catch(() => {});
            } else {
                hold.media.pause();
            }
            spaceHoldRef.current = null;
        };
        const activeVideo = (target: VideoSeekTarget) =>
            document.querySelector<HTMLVideoElement>(
                target === "lesson"
                    ? ".lesson-player video"
                    : ".solution-dialog video"
            );
        const seekWithFeedback = (
            target: VideoSeekTarget,
            amount: number,
            repeated: boolean
        ) => {
            const now = performance.now();
            const previousSeek = seekThrottleRef.current;
            if (
                repeated &&
                previousSeek?.target === target &&
                now - previousSeek.timestamp < 120
            )
                return;
            seekThrottleRef.current = { target, timestamp: now };
            const media = activeVideo(target);
            if (!media) return;
            skipVideo(media, amount);
            notifyVideoSeek(target, amount);
        };
        const key = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            const keyLower = event.key.toLowerCase();
            const isInteractiveTarget = target?.matches(
                "input, textarea, select, button, a, video, [contenteditable=true]"
            );
            if (scratchPadOpen) {
                if (keyLower === "q" || event.key === "Escape") {
                    event.preventDefault();
                    setScratchPadOpen(false);
                }
                return;
            }
            if (calculatorOpen) {
                if (event.key === "Escape") {
                    event.preventDefault();
                    setCalculatorOpen(false);
                }
                return;
            }
            const isTyping = Boolean(
                target?.matches("input, textarea, select, [contenteditable=true]")
            );
            if (
                !pending &&
                keyLower === "c" &&
                !isTyping &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey
            ) {
                event.preventDefault();
                setCalculatorOpen(true);
                return;
            }
            if (
                !pending &&
                keyLower === "q" &&
                (!isInteractiveTarget || route === "learn/video")
            ) {
                event.preventDefault();
                setScratchPadOpen(true);
                return;
            }
            if (
                event.key === " " &&
                !isTyping &&
                !target?.closest(".vjs-slider")
            ) {
                const videoTarget: VideoSeekTarget | null =
                    route === "learn/video"
                        ? "lesson"
                        : route === "practice/question" &&
                          target?.closest(".solution-dialog-backdrop")
                        ? "solution"
                        : null;
                if (videoTarget) {
                    event.preventDefault();
                    if (event.repeat || spaceHoldRef.current) return;
                    const media = activeVideo(videoTarget);
                    if (!media) return;
                    const hold = {
                        media,
                        previousRate: media.playbackRate,
                        wasPaused: media.paused,
                        timer: undefined as unknown as ReturnType<
                            typeof setTimeout
                        >,
                        activated: false,
                    };
                    hold.timer = setTimeout(() => {
                        if (spaceHoldRef.current !== hold) return;
                        hold.activated = true;
                        hold.media.playbackRate = 2;
                        hold.media.play().catch(() => {});
                    }, 180);
                    spaceHoldRef.current = hold;
                    return;
                }
            }
            if (
                route === "practice/question" &&
                target?.closest(".solution-dialog-backdrop") &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
            ) {
                if (
                    !isTyping &&
                    !target?.closest(".vjs-slider")
                ) {
                    event.preventDefault();
                    seekWithFeedback(
                        "solution",
                        event.key === "ArrowRight" ? 10 : -10,
                        event.repeat
                    );
                }
                return;
            }
            if (
                route === "learn/video" &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
            ) {
                if (
                    !target?.matches(
                        "input, textarea, select, [contenteditable=true]"
                    ) &&
                    !target?.closest(".vjs-slider")
                ) {
                    const endScreen =
                        document.querySelector(".lesson-end-screen");
                    if (endScreen) {
                        event.preventDefault();
                        if (event.key === "ArrowLeft")
                            document
                                .querySelector<HTMLButtonElement>(
                                    ".lesson-end-screen .end-prev:not(:disabled)"
                                )
                                ?.click();
                        else
                            document
                                .querySelector<HTMLButtonElement>(
                                    ".lesson-end-screen .end-next:not(:disabled)"
                                )
                                ?.click();
                        return;
                    }
                    event.preventDefault();
                    seekWithFeedback(
                        "lesson",
                        event.key === "ArrowRight" ? 10 : -10,
                        event.repeat
                    );
                    return;
                }
            }
            if (
                (route === "learn/video" || route === "practice/question") &&
                !target?.matches(
                    "input, textarea, select, [contenteditable=true]"
                )
            ) {
                const k = event.key.toLowerCase();
                if (k === "f") {
                    event.preventDefault();
                    const fsBtn = document.querySelector<HTMLButtonElement>(
                        route === "learn/video"
                            ? ".lesson-player .vjs-fullscreen-control"
                            : ".solution-dialog .vjs-fullscreen-control"
                    );
                    if (fsBtn) {
                        fsBtn.click();
                    } else {
                        const container =
                            document.querySelector<HTMLElement>(
                                route === "learn/video"
                                    ? ".lesson-player"
                                    : ".solution-dialog .solution-video-player"
                            ) ??
                            document.querySelector<HTMLVideoElement>(
                                route === "learn/video"
                                    ? ".lesson-player video"
                                    : ".solution-dialog video"
                            );
                        if (container) {
                            if (document.fullscreenElement)
                                document.exitFullscreen().catch(() => {});
                            else container.requestFullscreen().catch(() => {});
                        }
                    }
                    return;
                }
                if (k === "m") {
                    event.preventDefault();
                    const player = document.querySelector<HTMLVideoElement>(
                        route === "learn/video"
                            ? ".lesson-player video"
                            : ".solution-dialog video"
                    );
                    if (player) player.muted = !player.muted;
                    return;
                }
            }
            if (
                target?.matches(
                    "input, textarea, select, button, a, video, [contenteditable=true]"
                )
            )
                return;
            if (event.key === "/") {
                event.preventDefault();
                document
                    .querySelector<HTMLInputElement>(
                        "input[aria-label='Search lessons']"
                    )
                    ?.focus();
                return;
            }
            if (event.key === "?") {
                setNotice({
                    message:
                        "C Calculator · Q Scratch pad · / Search · G L Learn · G P Practice · J/K Move · Enter Act · N Next · Space Play/Pause · hold Space 2× · ← → Seek · F Fullscreen · M Mute",
                    tone: "warning",
                });
                return;
            }
            if (route === "learn/video" && event.key.toLowerCase() === "n") {
                document
                    .querySelector<HTMLButtonElement>(
                        ".next-lesson:not(:disabled)"
                    )
                    ?.click();
                return;
            }
            if (event.key.toLowerCase() === "g") {
                pending = true;
                setTimeout(timer, 650);
                return;
            }
            if (pending && event.key.toLowerCase() === "l") {
                pending = false;
                go("learn");
                return;
            }
            if (pending && event.key.toLowerCase() === "p") {
                pending = false;
                go("practice");
                return;
            }
            if (event.key === "j" || event.key === "k") {
                const options = [
                    ...document.querySelectorAll<HTMLElement>(
                        ".lesson-row, .choice"
                    ),
                ];
                const index = options.findIndex(
                    (node) => node === document.activeElement
                );
                options[
                    Math.max(
                        0,
                        Math.min(
                            options.length - 1,
                            index + (event.key === "j" ? 1 : -1)
                        )
                    )
                ]?.focus();
            }
        };
        const keyup = (event: KeyboardEvent) => {
            if (event.key !== " " || !spaceHoldRef.current) return;
            event.preventDefault();
            releaseSpaceHold();
        };
        const releaseOnBlur = () => releaseSpaceHold();
        addEventListener("keydown", key, true);
        addEventListener("keyup", keyup, true);
        addEventListener("blur", releaseOnBlur);
        return () => {
            removeEventListener("keydown", key, true);
            removeEventListener("keyup", keyup, true);
            removeEventListener("blur", releaseOnBlur);
            releaseSpaceHold();
        };
    }, [route, scratchPadOpen, calculatorOpen]);
    if (loading)
        return (
            <main className="center-state">
                <span className="spinner" />
                Preparing your study desk…
            </main>
        );
    if (catalogError)
        return (
            <main className="center-state">
                <BookOpen size={30} />
                <h1>Course catalog unavailable</h1>
                <p>{catalogError}</p>
                <code>npm run build && npm run dev</code>
                <p>
                    Then refresh this page. The API must be running at port
                    8787.
                </p>
            </main>
        );
    return (
        <div className="app-shell">
            {route !== "learn/video" && (
                <ScratchPad
                    open={scratchPadOpen}
                    onClose={() => setScratchPadOpen(false)}
                />
            )}
            {route !== "learn/video" && (
                <GreCalculator
                    open={calculatorOpen}
                    onClose={() => setCalculatorOpen(false)}
                />
            )}
            <a className="skip-link" href="#main-content">
                Skip to content
            </a>
            <Nav
                route={route}
                go={go}
                onInstall={pwa.install}
                canInstall={Boolean(pwa.installEvent)}
            />
            {!online && (
                <div className="offline-bar" role="status">
                    <WifiOff size={15} /> You are offline — downloaded lessons,
                    questions and flashcards still work.
                </div>
            )}
            <main className="page" id="main-content" tabIndex={-1}>
                <InstallBanner
                    visible={pwa.showInstall}
                    onInstall={pwa.install}
                    onDismiss={pwa.dismissInstall}
                />
                <UpdateToast
                    visible={pwa.updateReady}
                    onUpdate={pwa.applyUpdate}
                />
                {notice && (
                    <div className={`notice ${notice.tone}`} role="status">
                        {notice.message}
                        <button onClick={() => setNotice(null)}>×</button>
                    </div>
                )}
                {route === "learn" ? (
                    <Learn catalogs={catalogs} boot={boot} />
                ) : route === "learn/video" ? (
                    <LearnPlayer
                        catalogs={catalogs}
                        boot={boot}
                        mutate={mutate}
                        scratchPadOpen={scratchPadOpen}
                        onScratchPadClose={() => setScratchPadOpen(false)}
                        calculatorOpen={calculatorOpen}
                        onCalculatorClose={() => setCalculatorOpen(false)}
                        onProgress={(
                            videoId,
                            positionSeconds,
                            completed,
                            watched
                        ) =>
                            setBoot((current) => ({
                                ...current,
                                videos: [
                                    ...current.videos.filter(
                                        (item) => item.videoId !== videoId
                                    ),
                                    {
                                        videoId,
                                        positionSeconds,
                                        watched: Number(watched),
                                        completed: Number(completed),
                                    },
                                ],
                            }))
                        }
                    />
                ) : route === "practice" ? (
                    <Practice
                        catalogs={catalogs}
                        boot={boot}
                        user={user}
                        onBoot={setBoot}
                    />
                ) : route === "practice/question" ? (
                    <PracticeQuestion
                        catalogs={catalogs}
                        boot={boot}
                        user={user}
                        mutate={mutate}
                        onBoot={setBoot}
                    />
                ) : route === "memorize" ? (
                    <Memorize
                        user={user}
                        progress={boot.memorizeProgress ?? []}
                        mutate={mutate}
                        onProgress={handleMemorizeProgress}
                    />
                ) : route === "account" ? (
                    <Account
                        user={user}
                        onUser={setUser}
                        onBoot={setBoot}
                        theme={theme}
                        onTheme={setTheme}
                    />
                ) : (
                    <Dashboard
                        catalogs={catalogs}
                        boot={boot}
                        allVideos={allVideos}
                        go={go}
                    />
                )}
            </main>
        </div>
    );
}
function Nav({
    route,
    go,
    onInstall,
    canInstall,
}: {
    route: string;
    go: (route: string) => void;
    onInstall: () => void;
    canInstall: boolean;
}) {
    const links = [
        { id: "dashboard", label: "Home", icon: House },
        { id: "learn", label: "Learn", icon: BookOpen },
        { id: "practice", label: "Practice", icon: Target },
        { id: "memorize", label: "Memorize", icon: Brain },
        { id: "account", label: "Account", icon: CircleUserRound },
    ];
    const isActive = (id: string) =>
        route === id ||
        route.startsWith(`${id}/`) ||
        (id === "dashboard" && route === "dashboard");
    const handleGo = (destination: string) => go(destination);
    const goMemorize = (source: string) => {
        handleGo("memorize");
        setParams({ source });
    };
    return (
        <>
            <header className="site-nav">
                <div className="nav-inner">
                    <button
                        className="brand"
                        onClick={() => handleGo("dashboard")}
                    >
                        <span className="brand-mark">G</span>
                        <span>
                            GrePrep <b>GRE</b>
                        </span>
                    </button>
                    <nav
                        className="nav-links"
                        aria-label="Primary navigation"
                    >
                        {links.slice(0, 4).map((link) => {
                            if (link.id === "memorize") {
                                return (
                                    <div
                                        key={link.id}
                                        className="nav-dropdown-wrapper"
                                    >
                                        <button
                                            className={`nav-dropdown-btn ${
                                                isActive(link.id)
                                                    ? "active"
                                                    : ""
                                            }`}
                                            onClick={() =>
                                                handleGo("memorize")
                                            }
                                            aria-haspopup="true"
                                        >
                                            {link.label}
                                        </button>
                                        <div className="nav-dropdown-menu">
                                            <button
                                                className={
                                                    route.startsWith(
                                                        "memorize"
                                                    ) &&
                                                    getParam(
                                                        "source",
                                                        "verbal"
                                                    ) === "verbal"
                                                        ? "selected"
                                                        : ""
                                                }
                                                onClick={() =>
                                                    goMemorize("verbal")
                                                }
                                            >
                                                Verbal Mountain
                                            </button>
                                            <button
                                                className={
                                                    route.startsWith(
                                                        "memorize"
                                                    ) &&
                                                    getParam(
                                                        "source",
                                                        "verbal"
                                                    ) === "quant"
                                                        ? "selected"
                                                        : ""
                                                }
                                                onClick={() =>
                                                    goMemorize("quant")
                                                }
                                            >
                                                Quant Mountain
                                            </button>
                                            <button
                                                className={
                                                    route.startsWith(
                                                        "memorize"
                                                    ) &&
                                                    getParam(
                                                        "source",
                                                        "verbal"
                                                    ) ===
                                                        "quant-overwhelmed"
                                                        ? "selected"
                                                        : ""
                                                }
                                                onClick={() =>
                                                    goMemorize(
                                                        "quant-overwhelmed"
                                                    )
                                                }
                                            >
                                                Quant Overwhelmed
                                            </button>
                                        </div>
                                    </div>
                                );
                            }
                            return (
                                <button
                                    key={link.id}
                                    className={
                                        isActive(link.id) ? "active" : ""
                                    }
                                    onClick={() => handleGo(link.id)}
                                    aria-current={
                                        isActive(link.id)
                                            ? "page"
                                            : undefined
                                    }
                                >
                                    {link.label}
                                </button>
                            );
                        })}
                    </nav>
                    <div className="nav-util">
                        {canInstall && (
                            <button
                                className="nav-account install-btn"
                                onClick={onInstall}
                                title="Install app"
                            >
                                <Download size={18} />
                                <span>Install</span>
                            </button>
                        )}
                        <button
                            className={`nav-account ${
                                route === "account" ? "active" : ""
                            }`}
                            onClick={() => handleGo("account")}
                        >
                            <CircleUserRound size={18} />
                            <span>Account</span>
                        </button>
                    </div>
                </div>
            </header>
            <nav className="tabbar" aria-label="Primary navigation mobile">
                {links.map((link) => {
                    const Icon = link.icon;
                    const active = isActive(link.id);
                    return (
                        <button
                            key={link.id}
                            className={`tabbar-item ${
                                active ? "active" : ""
                            }`}
                            onClick={() => handleGo(link.id)}
                            aria-current={active ? "page" : undefined}
                        >
                            <Icon
                                size={20}
                                aria-hidden="true"
                            />
                            <span>{link.label}</span>
                        </button>
                    );
                })}
            </nav>
        </>
    );
}
function getResumeVideo(allVideos: any[], bootVideos: Bootstrap["videos"]) {
    if (!allVideos.length) return undefined;
    const lastIncomplete = [...bootVideos]
        .reverse()
        .find(
            (v) => !v.completed && (v.positionSeconds > 0 || Boolean(v.watched))
        );
    if (lastIncomplete) {
        const video = allVideos.find((v) => v.id === lastIncomplete.videoId);
        if (video) return video;
    }
    const lastCompleted = [...bootVideos]
        .reverse()
        .find((v) => Boolean(v.completed));
    if (lastCompleted) {
        const index = allVideos.findIndex(
            (v) => v.id === lastCompleted.videoId
        );
        if (index !== -1 && index + 1 < allVideos.length)
            return allVideos[index + 1];
        if (index !== -1) return allVideos[index];
    }
    return allVideos[0];
}
function ResumeCourse({
    subject,
    videos,
    boot,
}: {
    subject: Subject;
    videos: any[];
    boot: Bootstrap;
}) {
    const resume = getResumeVideo(
        videos,
        boot.videos.filter((video) => video.videoId.startsWith(`${subject}:`))
    );
    const done = boot.videos.filter(
        (video) => video.videoId.startsWith(`${subject}:`) && video.completed
    ).length;
    return (
        <section className="resume-panel">
            <div>
                <span className="section-label">
                    {subject === "quant" ? "Quant" : "Verbal"} · Resume your
                    course
                </span>
                <h2>
                    <MathText value={resume?.title ?? "Your first lesson"} />
                </h2>
                <p>
                    {resume
                        ? "Continue from where you paused—your place is saved as you go."
                        : "Download a catalog to start learning."}
                </p>
                <button
                    className="primary"
                    onClick={() => resume && openLesson(resume.id, subject)}
                >
                    <Play size={17} fill="currentColor" /> Continue learning
                </button>
            </div>
            <div className="index-plate">
                <span>{done.toString().padStart(2, "0")}</span>
                <small>lessons completed</small>
            </div>
        </section>
    );
}
function Dashboard({
    catalogs,
    boot,
    allVideos,
    go,
}: {
    catalogs: Catalogs;
    boot: Bootstrap;
    allVideos: any[];
    go: (r: string) => void;
}) {
    const done = boot.videos.filter((v) => v.completed).length,
        attempts = boot.attempts.length,
        accuracy = attempts
            ? Math.round(
                  (boot.attempts.filter((a) => a.correct).length / attempts) *
                      100
              )
            : 0;
    return (
        <>
            <section className="page-intro">
                <h1>Make today count.</h1>
                <p>
                    Pick up one clean thread, then let the next step reveal
                    itself.
                </p>
            </section>
            <section className="resume-courses">
                <ResumeCourse
                    subject="quant"
                    videos={catalogs.videos.quant.categories.flatMap(
                        (category) => category.videos
                    )}
                    boot={boot}
                />
                <ResumeCourse
                    subject="verbal"
                    videos={catalogs.videos.verbal.categories.flatMap(
                        (category) => category.videos
                    )}
                    boot={boot}
                />
            </section>
            <section className="overview-grid">
                <div className="progress-block">
                    <div className="section-line">
                        <h2>Course progress</h2>
                        <span>{pct(done, allVideos.length)}%</span>
                    </div>
                    <div className="meter">
                        <i
                            style={{ width: `${pct(done, allVideos.length)}%` }}
                        />
                    </div>
                    <p>
                        {done} of {allVideos.length} videos completed across
                        Quant and Verbal.
                    </p>
                </div>
                <div className="practice-block">
                    <h2>Practice pulse</h2>
                    <strong>
                        {attempts ? `${accuracy}%` : "Ready when you are"}
                    </strong>
                    <p>
                        {attempts
                            ? `${attempts} submitted answers in your recent history.`
                            : "Start with a single question; feedback is immediate."}
                    </p>
                    <button
                        className="text-button"
                        onClick={() => go("practice")}
                    >
                        Open practice <ChevronRight size={16} />
                    </button>
                </div>
            </section>
        </>
    );
}
let videojsLoader: Promise<any> | undefined;
const loadVideojs = () =>
    (videojsLoader ??= import("video.js").then(({ default: videojs }) => videojs));
type LessonPlayerProps = {
    videoId: string;
    src: string;
    scratchPadOpen: boolean;
    onScratchPadClose: () => void;
    calculatorOpen: boolean;
    onCalculatorClose: () => void;
    lessonTitle: string;
    collectionTitle?: string;
    videoRef: { current: HTMLVideoElement | null };
    playbackRate: number;
    onPlaybackRateChange: (rate: number) => void;
    onLoadedMetadata: (element: HTMLVideoElement) => void;
    onPlay: (element: HTMLVideoElement) => void;
    onTimeUpdate: (element: HTMLVideoElement) => void;
    onPause: (element: HTMLVideoElement) => void;
    onEnded: (element: HTMLVideoElement) => void;
    ended?: boolean;
    onReplay?: () => void;
    previous?: any;
    next?: any;
    onSelectLesson?: (id: string) => void;
    autoNext?: boolean;
    autoPlay?: boolean;
    countdown?: number | null;
    onCancelCountdown?: () => void;
};
function LessonPlayer(props: LessonPlayerProps) {
    const {
        videoId,
        src,
        scratchPadOpen,
        onScratchPadClose,
        calculatorOpen,
        onCalculatorClose,
        lessonTitle,
        collectionTitle,
        videoRef,
        playbackRate,
        onPlaybackRateChange,
        onLoadedMetadata,
        onPlay,
        onTimeUpdate,
        onPause,
        onEnded,
        ended,
        onReplay,
        previous,
        next,
        onSelectLesson,
        autoNext,
        autoPlay,
        countdown,
        onCancelCountdown,
    } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);
    const backgroundPlaybackRef = useRef(false);
    const [loading, setLoading] = useState(true),
        [buffering, setBuffering] = useState(false),
        [error, setError] = useState<string | null>(null),
        [playing, setPlaying] = useState(false),
        [isFullscreen, setIsFullscreen] = useState(false),
        [controlsVisible, setControlsVisible] = useState(true);
    const shouldAutoPlay = useRef(false);
    const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showControls = useCallback(() => {
        setControlsVisible(true);
        if (controlsTimerRef.current) {
            clearTimeout(controlsTimerRef.current);
        }
        controlsTimerRef.current = setTimeout(() => {
            setControlsVisible(false);
            controlsTimerRef.current = null;
        }, 2000);
    }, []);
    useEffect(() => {
        showControls();
        return () => {
            if (controlsTimerRef.current) {
                clearTimeout(controlsTimerRef.current);
                controlsTimerRef.current = null;
            }
        };
    }, [videoId, showControls]);
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let disposed = false;
        let player: any;
        let removeFullscreenListeners = () => {};
        let removeBackgroundListeners = () => {};
        setLoading(true);
        setBuffering(false);
        setError(null);

        loadVideojs()
            .then((videojs) => {
                if (disposed) return;
                const element = document.createElement("video-js");
                host.appendChild(element);
                player = videojs(element, {
                    controls: true,
                    preload: "auto",
                    playsinline: true,
                    playbackRates: [0.75, 1, 1.25, 1.5, 1.75, 2],
                    controlBar: {
                        children: [
                            "playToggle",
                            "currentTimeDisplay",
                            "progressControl",
                            "durationDisplay",
                            "volumePanel",
                            "playbackRateMenuButton",
                            "fullscreenToggle",
                        ],
                    },
                });

                player.requestFullscreen = function () {
                    const el = containerRef.current;
                    const media = el?.querySelector("video") as any;
                    if (!el) return;
                    const isAppleMobile =
                        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                        (navigator.platform === "MacIntel" &&
                            navigator.maxTouchPoints > 1);
                    if (isAppleMobile && media?.webkitEnterFullscreen) {
                        media.webkitEnterFullscreen();
                    } else if (el.requestFullscreen) {
                        el.requestFullscreen().catch(() => {});
                    } else if ("webkitRequestFullscreen" in el) {
                        (el as any).webkitRequestFullscreen();
                    }
                };

                player.exitFullscreen = function () {
                    const media = containerRef.current?.querySelector(
                        "video"
                    ) as any;
                    if (document.fullscreenElement && document.exitFullscreen) {
                        document.exitFullscreen().catch(() => {});
                    } else if ((document as any).webkitFullscreenElement) {
                        (document as any).webkitExitFullscreen?.();
                    } else if (media?.webkitExitFullscreen) {
                        media.webkitExitFullscreen();
                    }
                };

                player.isFullscreen = function () {
                    const media = containerRef.current?.querySelector(
                        "video"
                    ) as any;
                    return Boolean(
                        document.fullscreenElement &&
                            (document.fullscreenElement ===
                                containerRef.current ||
                                containerRef.current?.contains(
                                    document.fullscreenElement
                                )) ||
                            (document as any).webkitFullscreenElement ||
                            media?.webkitDisplayingFullscreen
                    );
                };

                playerRef.current = player;
                const media = () =>
                    player
                        .el()
                        .querySelector("video") as HTMLVideoElement | null;
                const prepareMediaElement = (current: HTMLVideoElement | null) => {
                    if (!current) return;
                    current.setAttribute("playsinline", "");
                    current.setAttribute("webkit-playsinline", "");
                    current.setAttribute("x-webkit-airplay", "allow");
                };
                player.ready(() => prepareMediaElement(media()));

                const isAppleMobile =
                    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === "MacIntel" &&
                        navigator.maxTouchPoints > 1);
                const backgroundAudio = isAppleMobile
                    ? document.createElement("audio")
                    : null;
                if (backgroundAudio) {
                    backgroundAudio.src = src;
                    backgroundAudio.preload = "auto";
                    backgroundAudio.setAttribute("playsinline", "");
                    backgroundAudio.setAttribute("aria-hidden", "true");
                    Object.assign(backgroundAudio.style, {
                        position: "absolute",
                        width: "1px",
                        height: "1px",
                        opacity: "0",
                        pointerEvents: "none",
                    });
                    host.appendChild(backgroundAudio);
                    backgroundAudioRef.current = backgroundAudio;
                }
                const mediaSession = (navigator as Navigator & {
                    mediaSession?: any;
                }).mediaSession;
                const setMediaSessionState = (
                    state: "none" | "paused" | "playing"
                ) => {
                    if (mediaSession) mediaSession.playbackState = state;
                };
                const warmBackgroundAudio = (current: HTMLVideoElement) => {
                    if (!backgroundAudio || backgroundPlaybackRef.current) return;
                    backgroundAudio.muted = true;
                    backgroundAudio.playbackRate = current.playbackRate;
                    try {
                        backgroundAudio.currentTime = current.currentTime;
                    } catch {}
                    backgroundAudio.play().catch(() => {});
                };
                const enterBackgroundPlayback = () => {
                    const current = media();
                    if (
                        !backgroundAudio ||
                        !current ||
                        current.paused ||
                        current.ended ||
                        backgroundPlaybackRef.current
                    )
                        return;
                    backgroundPlaybackRef.current = true;
                    backgroundAudio.muted = false;
                    backgroundAudio.playbackRate = current.playbackRate;
                    try {
                        backgroundAudio.currentTime = current.currentTime;
                    } catch {}
                    current.muted = true;
                    current.pause();
                    backgroundAudio.play().catch(() => {
                        backgroundPlaybackRef.current = false;
                        backgroundAudio.pause();
                        backgroundAudio.muted = true;
                        current.muted = false;
                        setMediaSessionState("paused");
                    });
                    setMediaSessionState("playing");
                };
                const leaveBackgroundPlayback = () => {
                    const current = media();
                    if (!backgroundAudio || !current || !backgroundPlaybackRef.current)
                        return;
                    const shouldResume =
                        !backgroundAudio.paused && !backgroundAudio.ended;
                    backgroundAudio.pause();
                    if (Number.isFinite(backgroundAudio.currentTime))
                        current.currentTime = backgroundAudio.currentTime;
                    current.muted = false;
                    backgroundPlaybackRef.current = false;
                    if (shouldResume) current.play().catch(() => {});
                };
                const onBackgroundTimeUpdate = () => {
                    if (!backgroundPlaybackRef.current || !backgroundAudio) return;
                    const current = media();
                    if (!current) return;
                    current.currentTime = backgroundAudio.currentTime;
                    onTimeUpdate(current);
                };
                const onBackgroundEnded = () => {
                    if (!backgroundPlaybackRef.current) return;
                    const current = media();
                    backgroundPlaybackRef.current = false;
                    if (!current) return;
                    current.muted = false;
                    if (Number.isFinite(backgroundAudio?.duration))
                        current.currentTime = backgroundAudio?.duration ?? current.currentTime;
                    setPlaying(false);
                    setMediaSessionState("paused");
                    onEnded(current);
                };
                const onVisibilityChange = () => {
                    if (document.visibilityState === "hidden")
                        enterBackgroundPlayback();
                    else leaveBackgroundPlayback();
                };
                const onPageHide = () => enterBackgroundPlayback();
                const onPageShow = () => leaveBackgroundPlayback();
                if (backgroundAudio) {
                    backgroundAudio.addEventListener(
                        "timeupdate",
                        onBackgroundTimeUpdate
                    );
                    backgroundAudio.addEventListener("ended", onBackgroundEnded);
                    document.addEventListener(
                        "visibilitychange",
                        onVisibilityChange
                    );
                    window.addEventListener("pagehide", onPageHide);
                    window.addEventListener("pageshow", onPageShow);
                    removeBackgroundListeners = () => {
                        backgroundAudio.removeEventListener(
                            "timeupdate",
                            onBackgroundTimeUpdate
                        );
                        backgroundAudio.removeEventListener(
                            "ended",
                            onBackgroundEnded
                        );
                        document.removeEventListener(
                            "visibilitychange",
                            onVisibilityChange
                        );
                        window.removeEventListener("pagehide", onPageHide);
                        window.removeEventListener("pageshow", onPageShow);
                        backgroundAudio.pause();
                        backgroundAudio.removeAttribute("src");
                        backgroundAudio.load();
                        backgroundAudio.remove();
                        backgroundAudioRef.current = null;
                        backgroundPlaybackRef.current = false;
                    };
                }

                player.on("loadedmetadata", () => {
                    const current = media();
                    if (current) {
                        setLoading(false);
                        videoRef.current = current;
                        prepareMediaElement(current);
                        onLoadedMetadata(current);
                        if (autoPlay || shouldAutoPlay.current) {
                            shouldAutoPlay.current = false;
                            current.play().catch(() => {});
                        }
                    }
                });

                player.on("loadeddata", () => setLoading(false));
                player.on("canplay", () => {
                    setLoading(false);
                    setBuffering(false);
                });
                player.on("waiting", () => setBuffering(true));
                player.on("playing", () => {
                    setLoading(false);
                    setBuffering(false);
                });
                player.on("play", () => {
                    setPlaying(true);
                    setMediaSessionState("playing");
                    const current = media();
                    if (current) {
                        warmBackgroundAudio(current);
                        onPlay(current);
                    }
                });
                player.on("timeupdate", () => {
                    const current = media();
                    if (current) onTimeUpdate(current);
                });
                player.on("pause", () => {
                    setPlaying(false);
                    setBuffering(false);
                    setMediaSessionState("paused");
                    if (backgroundAudio && !backgroundPlaybackRef.current)
                        backgroundAudio.pause();
                    const current = media();
                    if (current) onPause(current);
                });
                player.on("ended", () => {
                    if (backgroundAudio) backgroundAudio.pause();
                    backgroundPlaybackRef.current = false;
                    setBuffering(false);
                    setMediaSessionState("paused");
                    const current = media();
                    if (current) onEnded(current);
                });
                player.on("ratechange", () =>
                    onPlaybackRateChange(player.playbackRate() ?? 1)
                );
                player.on("error", () => {
                    setLoading(false);
                    setBuffering(false);
                    setError(
                        "This lesson could not be played. Check your connection, then try another lesson or reload the page."
                    );
                });

                player.src({ src, type: "video/mp4" });

                const onFsChange = () => {
                    setIsFullscreen(Boolean(player.isFullscreen()));
                    if (playerRef.current) {
                        playerRef.current.trigger("fullscreenchange");
                    }
                };
                document.addEventListener("fullscreenchange", onFsChange);
                document.addEventListener(
                    "webkitfullscreenchange",
                    onFsChange as EventListener
                );
                player.on("loadedmetadata", () => {
                    if (disposed) return;
                    const current = media() as any;
                    current?.addEventListener("webkitbeginfullscreen", onFsChange);
                    current?.addEventListener("webkitendfullscreen", onFsChange);
                });
                removeFullscreenListeners = () => {
                    document.removeEventListener("fullscreenchange", onFsChange);
                    document.removeEventListener(
                        "webkitfullscreenchange",
                        onFsChange as EventListener
                    );
                    const current = media() as any;
                    current?.removeEventListener(
                        "webkitbeginfullscreen",
                        onFsChange
                    );
                    current?.removeEventListener(
                        "webkitendfullscreen",
                        onFsChange
                    );
                };
            })
            .catch(() => {
                if (!disposed) {
                    setLoading(false);
                    setError(
                        "The video player could not be loaded. Reload the page and try again."
                    );
                }
            });

        return () => {
            disposed = true;
            removeFullscreenListeners();
            removeBackgroundListeners();
            setPlaying(false);
            setIsFullscreen(false);
            videoRef.current = null;
            player?.dispose();
            playerRef.current = null;
        };
    }, [videoId, src]);
    useEffect(() => {
        if (
            playerRef.current &&
            playerRef.current.playbackRate() !== playbackRate
        )
            playerRef.current.playbackRate(playbackRate);
    }, [playbackRate]);
    const navigateKeepFullscreen = (lessonId: string) => {
        onSelectLesson?.(lessonId);
    };
    const autoPlayNext = (lessonId: string) => {
        shouldAutoPlay.current = true;
        onSelectLesson?.(lessonId);
    };
    const togglePlay = () => {
        const media = videoRef.current;
        if (!media) return;
        if (media.paused || media.ended) media.play().catch(() => {});
        else media.pause();
    };
    const seekBy = (seconds: number) => {
        const media = videoRef.current;
        if (!media) return;
        const duration = Number.isFinite(media.duration) ? media.duration : 0;
        media.currentTime = Math.max(
            0,
            Math.min(duration || Number.MAX_SAFE_INTEGER, media.currentTime + seconds)
        );
        notifyVideoSeek("lesson", seconds);
    };
    const seekTo = (position: "start" | "end") => {
        const media = videoRef.current;
        if (!media) return;
        if (position === "start") {
            media.currentTime = 0;
            return;
        }
        if (Number.isFinite(media.duration) && media.duration > 0) {
            media.currentTime = Math.max(0, media.duration - 0.1);
        }
    };
    const toggleFullscreen = () => {
        const player = playerRef.current;
        if (!player) return;
        if (player.isFullscreen()) player.exitFullscreen();
        else player.requestFullscreen();
    };
    const seekFeedback = useVideoSeekFeedback("lesson");
    useEffect(() => {
        const cleanTitle = lessonTitle.trim() || "GRE lesson";
        const previousDocumentTitle = document.title;
        document.title = `${cleanTitle} · GRE Study Desk`;

        const mediaSession = (navigator as Navigator & {
            mediaSession?: any;
        }).mediaSession;
        const MediaMetadataConstructor = (
            window as Window & { MediaMetadata?: any }
        ).MediaMetadata;
        if (!mediaSession || !MediaMetadataConstructor) {
            return () => {
                document.title = previousDocumentTitle;
            };
        }

        const metadata = new MediaMetadataConstructor({
            title: cleanTitle,
            artist: "GRE Study Desk",
            album: collectionTitle?.trim() || "GRE Lessons",
        });
        mediaSession.metadata = metadata;
        const activeMedia = () =>
            backgroundPlaybackRef.current
                ? backgroundAudioRef.current
                : videoRef.current;
        const setActionHandler = (action: string, handler: any) => {
            try {
                mediaSession.setActionHandler(action, handler);
            } catch {}
        };
        const seek = (amount: number) => {
            const current = activeMedia();
            if (!current) return;
            const duration = Number.isFinite(current.duration)
                ? current.duration
                : Number.MAX_SAFE_INTEGER;
            current.currentTime = Math.max(
                0,
                Math.min(duration, current.currentTime + amount)
            );
        };
        setActionHandler("play", () => activeMedia()?.play().catch(() => {}));
        setActionHandler("pause", () => activeMedia()?.pause());
        setActionHandler("seekbackward", (details: any) =>
            seek(-(details.seekOffset ?? 10))
        );
        setActionHandler("seekforward", (details: any) =>
            seek(details.seekOffset ?? 10)
        );
        setActionHandler("seekto", (details: any) => {
            const current = activeMedia();
            if (!current || !Number.isFinite(details.seekTime)) return;
            if (details.fastSeek && "fastSeek" in current)
                current.fastSeek(details.seekTime);
            else current.currentTime = details.seekTime;
        });
        setActionHandler(
            "previoustrack",
            previous?.id && onSelectLesson
                ? () => onSelectLesson(previous.id)
                : null
        );
        setActionHandler(
            "nexttrack",
            next?.id && onSelectLesson
                ? () => onSelectLesson(next.id)
                : null
        );

        return () => {
            [
                "play",
                "pause",
                "seekbackward",
                "seekforward",
                "seekto",
                "previoustrack",
                "nexttrack",
            ].forEach((action) => setActionHandler(action, null));
            if (mediaSession.metadata === metadata) {
                mediaSession.metadata = null;
                mediaSession.playbackState = "none";
            }
            document.title = previousDocumentTitle;
        };
    }, [
        videoId,
        lessonTitle,
        collectionTitle,
        previous?.id,
        next?.id,
    ]);
    return (
        <div
            ref={containerRef}
            className={`video-frame lesson-player library-player ${
                loading ? "is-loading" : ""
            } ${buffering ? "is-buffering" : ""}`}
            aria-busy={loading || buffering}
            onMouseEnter={showControls}
            onMouseMove={showControls}
            onTouchStart={showControls}
        >
            <div ref={hostRef} />
            <ScratchPad open={scratchPadOpen} onClose={onScratchPadClose} />
            <GreCalculator open={calculatorOpen} onClose={onCalculatorClose} />
            <div
                className={`lesson-video-overlay ${
                    controlsVisible ? "" : "controls-hidden"
                }`}
                aria-hidden={!controlsVisible}
                aria-label="Video controls"
            >
                <div className="lesson-video-center-controls">
                    <button
                        type="button"
                        className="lesson-video-control"
                        aria-label="Go to start"
                        title="Go to start"
                        onClick={(event) => {
                            event.stopPropagation();
                            seekTo("start");
                        }}
                    >
                        <SkipBack size={22} />
                    </button>
                    <button
                        type="button"
                        className="lesson-video-control"
                        aria-label="Back 10 seconds"
                        title="Back 10 seconds"
                        onClick={(event) => {
                            event.stopPropagation();
                            seekBy(-10);
                        }}
                    >
                        <Rewind size={24} />
                    </button>
                    <button
                        type="button"
                        className="lesson-video-control lesson-video-play"
                        aria-label={playing ? "Pause video" : "Play video"}
                        title={playing ? "Pause" : "Play"}
                        onClick={(event) => {
                            event.stopPropagation();
                            togglePlay();
                        }}
                    >
                        {playing ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                    <button
                        type="button"
                        className="lesson-video-control"
                        aria-label="Forward 10 seconds"
                        title="Forward 10 seconds"
                        onClick={(event) => {
                            event.stopPropagation();
                            seekBy(10);
                        }}
                    >
                        <FastForward size={24} />
                    </button>
                    <button
                        type="button"
                        className="lesson-video-control"
                        aria-label="Go to end"
                        title="Go to end"
                        onClick={(event) => {
                            event.stopPropagation();
                            seekTo("end");
                        }}
                    >
                        <SkipForward size={22} />
                    </button>
                </div>
                <button
                    type="button"
                    className="lesson-video-fullscreen"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleFullscreen();
                    }}
                >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
            </div>
            {loading && <span className="video-loading">Loading lesson…</span>}
            {buffering && (
                <span className="video-buffering" role="status" aria-label="Buffering">
                    <span className="video-buffering-spinner" />
                </span>
            )}
            {seekFeedback && (
                <span
                    key={`${seekFeedback.direction}-${seekFeedback.seconds}`}
                    className={`video-seek-feedback ${seekFeedback.direction}`}
                    role="status"
                    aria-live="polite"
                >
                    {seekFeedback.direction === "forward" ? (
                        <FastForward size={20} aria-hidden="true" />
                    ) : (
                        <Rewind size={20} aria-hidden="true" />
                    )}
                    <strong>{seekFeedback.seconds}s</strong>
                </span>
            )}
            {error && (
                <p className="video-error" role="alert">
                    {error}
                </p>
            )}
            {ended && (
                <div className="lesson-end-screen">
                    <div className="end-screen-content">
                        <h2>Lesson complete</h2>
                        <div className="end-screen-actions">
                            <button
                                className="end-prev"
                                disabled={!previous}
                                onClick={() =>
                                    previous &&
                                    navigateKeepFullscreen(previous.id)
                                }
                            >
                                <ChevronLeft size={20} /> Previous lesson
                            </button>
                            <button className="end-replay" onClick={onReplay}>
                                <Play size={20} /> Replay
                            </button>
                            <button
                                className="end-next"
                                disabled={!next}
                                onClick={() => next && autoPlayNext(next.id)}
                            >
                                {countdown != null ? (
                                    <>
                                        <SkipForward size={18} /> Next in{" "}
                                        {countdown}s
                                    </>
                                ) : (
                                    <>
                                        Next lesson <ChevronRight size={20} />
                                    </>
                                )}
                            </button>
                        </div>
                        {countdown != null && (
                            <button
                                className="end-cancel-countdown"
                                onClick={onCancelCountdown}
                            >
                                <Pause size={14} /> Cancel
                            </button>
                        )}
                        <p className="end-screen-hint">
                            Use ← → arrow keys to navigate
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
const splitLessonColumns = (items: any[]) =>
    Array.from({ length: Math.ceil(items.length / 20) }, (_, index) =>
        items.slice(index * 20, index * 20 + 20)
    );
const openLesson = (lessonId: string, subject: Subject) => {
    const query = new URLSearchParams(location.search);
    query.set("subject", subject);
    query.set("video", lessonId);
    history.pushState({}, "", `/learn/video?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
};
const returnToLessons = (subject: Subject) => {
    const query = new URLSearchParams(location.search);
    query.set("subject", subject);
    query.delete("video");
    history.pushState({}, "", `/learn?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
};
function useAutoSettings() {
    const [autoNext, setAutoNextState] = useState(() =>
        readBool(autoNextKey, true)
    );
    const [autoPlay, setAutoPlayState] = useState(() =>
        readBool(autoPlayKey, true)
    );
    const setAutoNext = useCallback((v: boolean) => {
        setAutoNextState(v);
        storeBool(autoNextKey, v);
    }, []);
    const setAutoPlay = useCallback((v: boolean) => {
        setAutoPlayState(v);
        storeBool(autoPlayKey, v);
    }, []);
    return { autoNext, setAutoNext, autoPlay, setAutoPlay };
}
function AutoToggles({
    autoNext,
    onAutoNextChange,
    autoPlay,
    onAutoPlayChange,
}: {
    autoNext: boolean;
    onAutoNextChange: (v: boolean) => void;
    autoPlay: boolean;
    onAutoPlayChange: (v: boolean) => void;
}) {
    return (
        <div className="auto-toggles" aria-label="Playback settings">
            <button
                type="button"
                className={`auto-toggle-btn ${autoNext ? "active" : ""}`}
                onClick={() => onAutoNextChange(!autoNext)}
                title="Automatically advance to next lesson when video finishes"
            >
                Auto-next {autoNext ? "ON" : "OFF"}
            </button>
            <button
                type="button"
                className={`auto-toggle-btn ${autoPlay ? "active" : ""}`}
                onClick={() => onAutoPlayChange(!autoPlay)}
                title="Automatically play video when a lesson loads"
            >
                Auto-play {autoPlay ? "ON" : "OFF"}
            </button>
        </div>
    );
}
function Learn({ catalogs, boot }: { catalogs: Catalogs; boot: Bootstrap }) {
    const { autoNext, setAutoNext, autoPlay, setAutoPlay } = useAutoSettings();
    const subject = getParam("subject", "quant") as Subject;
    const [search, setSearch] = useState(getParam("q", ""));
    const categoryFilter = getParam("category", "");
    const watchedFilter = getParam("watched", "");
    const hasActiveFilters = Boolean(search || categoryFilter || watchedFilter);
    const [filtersOpen, setFiltersOpen] = useState(hasActiveFilters);
    useEffect(() => {
        if (hasActiveFilters) setFiltersOpen(true);
    }, [hasActiveFilters]);
    const course = catalogs.videos[subject];
    const flat = course.categories.flatMap((c) => c.videos);
    const watchedIds = new Set(
        boot.videos
            .filter(
                (progress) =>
                    Boolean(progress.watched) || Boolean(progress.completed)
            )
            .map((progress) => progress.videoId)
    );
    const completedIds = new Set(
        boot.videos
            .filter((progress) => Boolean(progress.completed))
            .map((progress) => progress.videoId)
    );
    const progressById = new Map(
        boot.videos.map((progress) => [progress.videoId, progress])
    );
    const visibleCategories = course.categories
        .map((category) => ({
            ...category,
            videos: category.videos.filter(
                (item) =>
                    item.title.toLowerCase().includes(search.toLowerCase()) &&
                    (!watchedFilter ||
                        (watchedFilter === "watched"
                            ? watchedIds.has(item.id)
                            : !watchedIds.has(item.id)))
            ),
        }))
        .filter(
            (category) =>
                (!categoryFilter || category.id === categoryFilter) &&
                category.videos.length
        );
    const clearFilters = () => {
        setSearch("");
        setFiltersOpen(false);
        setParams({ category: undefined, watched: undefined });
    };
    return (
        <>
            <section className="learn-head">
                <div>
                    <h1>Learn</h1>
                    <p>
                        <MathText value={course.title} /> ·{" "}
                        {course.categories.length} chapters · {flat.length}{" "}
                        lessons
                    </p>
                </div>
                <div className="learn-header-controls">
                    <div className="subject-switch">
                        <button
                            className={subject === "quant" ? "selected" : ""}
                            onClick={() =>
                                setParams({
                                    subject: "quant",
                                    category: undefined,
                                    watched: undefined,
                                    video: undefined,
                                })
                            }
                        >
                            Quant
                        </button>
                        <button
                            className={subject === "verbal" ? "selected" : ""}
                            onClick={() =>
                                setParams({
                                    subject: "verbal",
                                    category: undefined,
                                    watched: undefined,
                                    video: undefined,
                                })
                            }
                        >
                            Verbal
                        </button>
                    </div>
                    <AutoToggles
                        autoNext={autoNext}
                        onAutoNextChange={setAutoNext}
                        autoPlay={autoPlay}
                        onAutoPlayChange={setAutoPlay}
                    />
                </div>
                <button
                    type="button"
                    className={`mobile-filter-toggle ${
                        hasActiveFilters ? "has-active" : ""
                    }`}
                    onClick={() => setFiltersOpen((open) => !open)}
                    aria-expanded={filtersOpen}
                    aria-controls="lesson-filters"
                >
                    <SlidersHorizontal size={18} />
                    Filters{hasActiveFilters ? " (active)" : ""}
                </button>
            </section>
            <section
                className="lesson-catalogue"
                aria-labelledby="chapter-browser-title"
            >
                <div className="catalogue-heading">
                    <div>
                        <h2 id="chapter-browser-title">All chapters</h2>
                        <p>
                            Browse every chapter, or narrow the list to find a
                            lesson.
                        </p>
                    </div>
                    <span>
                        {visibleCategories.reduce(
                            (total, category) => total + category.videos.length,
                            0
                        )}{" "}
                        lessons shown
                    </span>
                </div>
                <div
                    id="lesson-filters"
                    className={`catalogue-filters ${filtersOpen ? "is-open" : ""}`}
                    aria-label="Lesson filters"
                >
                    <label className="search">
                        <Search size={17} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search lessons"
                            aria-label="Search lessons"
                        />
                    </label>
                    <label className="chapter-filter">
                        <span>Category</span>
                        <select
                            value={categoryFilter}
                            onChange={(event) =>
                                setParams({
                                    category: event.target.value || undefined,
                                })
                            }
                        >
                            <option value="">All categories</option>
                            {course.categories.map((category) => (
                                <option value={category.id} key={category.id}>
                                    {category.title}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="chapter-filter">
                        <span>Watching status</span>
                        <select
                            value={watchedFilter}
                            onChange={(event) =>
                                setParams({
                                    watched: event.target.value || undefined,
                                })
                            }
                        >
                            <option value="">All videos</option>
                            <option value="watched">Watched</option>
                            <option value="unwatched">Unwatched</option>
                        </select>
                    </label>
                </div>
                {visibleCategories.length ? (
                    <div className="chapter-grid">
                        {visibleCategories.map((category) => {
                            const columns = splitLessonColumns(category.videos);
                            return (
                                <section
                                    className={`chapter-section ${
                                        columns.length > 1 ? "has-columns" : ""
                                    }`}
                                    key={category.id}
                                >
                                    <header>
                                        <h3>
                                            <MathText value={category.title} />
                                        </h3>
                                        <span>
                                            {category.videos.length} lesson
                                            {category.videos.length === 1
                                                ? ""
                                                : "s"}
                                        </span>
                                    </header>
                                    <div className="chapter-columns">
                                        {columns.map((lessons, columnIndex) => (
                                            <div
                                                className="chapter-column"
                                                key={columnIndex}
                                            >
                                                {columns.length > 1 && (
                                                    <span className="chapter-column-label">
                                                        Lessons{" "}
                                                        {columnIndex * 20 + 1}–
                                                        {columnIndex * 20 +
                                                            lessons.length}
                                                    </span>
                                                )}
                                                {lessons.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        className="lesson-row"
                                                        onClick={() =>
                                                            openLesson(
                                                                item.id,
                                                                subject
                                                            )
                                                        }
                                                    >
                                                        <span>
                                                            <MathText
                                                                value={
                                                                    item.title
                                                                }
                                                            />
                                                        </span>
                                                        {completedIds.has(item.id) ? (
                                                            <Check
                                                                size={15}
                                                                aria-label="Completed"
                                                            />
                                                        ) : watchedIds.has(item.id) ? (
                                                            <small>
                                                                {progressById.get(item.id)?.positionSeconds &&
                                                                item.durationSeconds
                                                                    ? `${Math.min(
                                                                          99,
                                                                          Math.round(
                                                                              ((progressById.get(item.id)
                                                                                  ?.positionSeconds ??
                                                                                  0) /
                                                                                  item.durationSeconds) *
                                                                                  100
                                                                          )
                                                                      )}%`
                                                                    : "In progress"}
                                                            </small>
                                                        ) : (
                                                            <small>
                                                                {item.durationSeconds
                                                                    ? `${Math.ceil(
                                                                          item.durationSeconds /
                                                                              60
                                                                      )}m`
                                                                    : ""}
                                                            </small>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    <section className="catalogue-empty">
                        <BookOpen size={24} />
                        <h3>No lessons match these filters.</h3>
                        <p>Try another category, status, or search.</p>
                        <button
                            className="clear-filters"
                            onClick={clearFilters}
                        >
                            Clear filters
                        </button>
                    </section>
                )}
            </section>
        </>
    );
}
function LearnPlayer({
    catalogs,
    boot,
    mutate,
    scratchPadOpen,
    onScratchPadClose,
    calculatorOpen,
    onCalculatorClose,
    onProgress,
}: {
    catalogs: Catalogs;
    boot: Bootstrap;
    mutate: (url: string, method: string, body: any) => void;
    scratchPadOpen: boolean;
    onScratchPadClose: () => void;
    calculatorOpen: boolean;
    onCalculatorClose: () => void;
    onProgress: (
        videoId: string,
        positionSeconds: number,
        completed: boolean,
        watched: boolean
    ) => void;
}) {
    const { autoNext, setAutoNext, autoPlay, setAutoPlay } = useAutoSettings();
    const subject = getParam("subject", "quant") as Subject;
    const [playbackRate, setPlaybackRate] = useState(1);
    const [ended, setEnded] = useState(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const course = catalogs.videos[subject];
    const flat = course.categories.flatMap((c) => c.videos);
    const video =
        flat.find((v) => v.id === getParam("video", flat[0]?.id ?? "")) ??
        flat[0];
    const videoRef = useRef<HTMLVideoElement>(null);
    const lastSaved = useRef(0);
    const completedRef = useRef(false);
    const watchedRef = useRef(false);
    const saveProgressRef = useRef<() => void>(() => {});
    const stored = boot.videos.find((item) => item.videoId === video?.id);
    const videoIndex = flat.findIndex((item) => item.id === video?.id);
    const previous = flat[videoIndex - 1];
    const next = flat[videoIndex + 1];
    const activeCategory = course.categories.find(
        (category) => category.id === video?.categoryId
    );
    const clearCountdown = useCallback(() => {
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
        }
        setCountdown(null);
    }, []);
    useEffect(() => {
        lastSaved.current = stored?.positionSeconds ?? 0;
        completedRef.current = Boolean(stored?.completed);
        watchedRef.current = Boolean(stored?.watched || stored?.completed);
        setPlaybackRate(1);
        setEnded(false);
        clearCountdown();
    }, [video?.id, clearCountdown]);
    useEffect(() => () => clearCountdown(), [clearCountdown]);
    const save = (
        completed = completedRef.current,
        element = videoRef.current,
        force = false
    ) => {
        if (!video) return;
        const rawPosition =
            element?.currentTime ?? stored?.positionSeconds ?? lastSaved.current;
        const positionSeconds = Number.isFinite(rawPosition)
            ? Math.max(0, rawPosition)
            : lastSaved.current;
        const watched =
            watchedRef.current || completedRef.current || completed;
        if (
            !force &&
            completedRef.current &&
            completed &&
            Math.abs(positionSeconds - lastSaved.current) < 2
        )
            return;
        if (
            !force &&
            !completed &&
            Math.abs(positionSeconds - lastSaved.current) < 2
        )
            return;
        completedRef.current = completedRef.current || completed;
        watchedRef.current = watched;
        lastSaved.current = positionSeconds;
        mutate(
            `/api/me/videos/${encodeURIComponent(video.id)}/progress`,
            `PUT`,
            {
                positionSeconds,
                watched,
                completed: completedRef.current,
                idempotencyKey: newIdempotencyKey(),
            }
        );
        onProgress(video.id, positionSeconds, completedRef.current, watched);
    };
    saveProgressRef.current = () =>
        save(completedRef.current, videoRef.current, true);
    useEffect(() => {
        const persist = () => saveProgressRef.current();
        const persistWhenHidden = () => {
            if (document.visibilityState === "hidden") persist();
        };
        window.addEventListener("pagehide", persist);
        document.addEventListener("visibilitychange", persistWhenHidden);
        return () => {
            window.removeEventListener("pagehide", persist);
            document.removeEventListener("visibilitychange", persistWhenHidden);
        };
    }, [video?.id]);
    if (!video) return <Empty label="No downloaded lessons yet." />;
    const descriptionElement = document.createElement("div");
    descriptionElement.innerHTML = video.descriptionHtml;
    const isExerciseDescription =
        descriptionElement.textContent?.trim() === `${video.title} Exercise`;
    const trackPlayback = (element: HTMLVideoElement) => {
        const duration = element.duration;
        const progress =
            Number.isFinite(duration) && duration > 0
                ? element.currentTime / duration
                : 0;
        const completesNow = progress >= 0.9;
        save(completesNow, element);
    };
    const resume = (element: HTMLVideoElement) => {
        if (
            stored?.positionSeconds &&
            Number.isFinite(element.duration) &&
            element.duration > 0 &&
            stored.positionSeconds < element.duration * 0.9
        )
            element.currentTime = stored.positionSeconds;
        element.playbackRate = playbackRate;
    };
    const selectLesson = (lessonId: string) => {
        save(completedRef.current, videoRef.current, true);
        setEnded(false);
        clearCountdown();
        openLesson(lessonId, subject);
    };
    const startCountdown = (nextId: string) => {
        clearCountdown();
        let remaining = 5;
        setCountdown(remaining);
        countdownRef.current = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearCountdown();
                document
                    .querySelector<HTMLButtonElement>(
                        ".lesson-end-screen .end-next:not(:disabled)"
                    )
                    ?.click();
            } else {
                setCountdown(remaining);
            }
        }, 1000);
    };
    const handleEnded = (element: HTMLVideoElement) => {
        watchedRef.current = true;
        save(true, element, true);
        setEnded(true);
        if (autoNext && next) startCountdown(next.id);
    };
    const replayVideo = () => {
        clearCountdown();
        const el = videoRef.current;
        if (el) {
            el.currentTime = 0;
            el.play().catch(() => {});
            setEnded(false);
        }
    };
    return (
        <>
            <section className="lesson-page-header">
                <button
                    className="back-to-lessons"
                    onClick={() => returnToLessons(subject)}
                >
                    <ChevronLeft size={18} /> All chapters
                </button>
                <div className="lesson-header-main">
                    <div>
                        <h1>
                            <MathText value={video.title} />
                        </h1>
                        <p>
                            <MathText value={activeCategory?.title ?? ""} /> ·
                            Lesson {videoIndex + 1} of {flat.length}
                        </p>
                    </div>
                    <AutoToggles
                        autoNext={autoNext}
                        onAutoNextChange={setAutoNext}
                        autoPlay={autoPlay}
                        onAutoPlayChange={setAutoPlay}
                    />
                </div>
            </section>
            <section className="player-area lesson-player-page">
                <nav
                    className="lesson-navigation lesson-navigation-above"
                    aria-label="Lesson navigation"
                >
                    <button
                        className="previous-lesson"
                        disabled={!previous}
                        onClick={() => previous && selectLesson(previous.id)}
                    >
                        <ChevronLeft size={17} /> Previous
                    </button>
                    <button
                        className="next-lesson"
                        disabled={!next}
                        onClick={() => next && selectLesson(next.id)}
                    >
                        Next lesson <ChevronRight size={17} />
                    </button>
                </nav>
                <LessonPlayer
                    videoId={video.id}
                    src={`/api/media/course/${encodeURIComponent(
                        video.mediaId
                    )}`}
                    scratchPadOpen={scratchPadOpen}
                    onScratchPadClose={onScratchPadClose}
                    calculatorOpen={calculatorOpen}
                    onCalculatorClose={onCalculatorClose}
                    lessonTitle={video.title}
                    collectionTitle={activeCategory?.title ?? course.title}
                    videoRef={videoRef}
                    playbackRate={playbackRate}
                    onPlaybackRateChange={(rate) => {
                        setPlaybackRate(rate);
                        if (videoRef.current)
                            videoRef.current.playbackRate = rate;
                    }}
                    onLoadedMetadata={resume}
                    onPlay={(element) => {
                        watchedRef.current = true;
                        save(false, element, true);
                    }}
                    onTimeUpdate={trackPlayback}
                    onPause={(element) =>
                        save(completedRef.current, element, true)
                    }
                    onEnded={handleEnded}
                    ended={ended}
                    onReplay={replayVideo}
                    previous={previous}
                    next={next}
                    onSelectLesson={selectLesson}
                    autoNext={autoNext}
                    autoPlay={autoPlay}
                    countdown={countdown}
                    onCancelCountdown={clearCountdown}
                />
                <div className="lesson-detail">
                    {!isExerciseDescription && (
                        <Html value={video.descriptionHtml} />
                    )}
                </div>
            </section>
        </>
    );
}
function QuestionInputs({
    question,
    selected,
    setSelected,
    feedback,
    vocabulary,
    onVocabularyWord,
}: {
    question: Question;
    selected: string[];
    setSelected: (value: string[]) => void;
    feedback: any;
    vocabulary: VocabularyIndex;
    onVocabularyWord: (item: MountainItem, anchor: HTMLElement) => void;
}) {
    const disabled = Boolean(feedback?.correct);
    const choose = (id: string, groupId?: string) => {
        if (
            question.type === "Multiple Choice" ||
            question.type === "Quantitative Comparison"
        )
            return setSelected([id]);
        if (question.type.startsWith("TC ") && groupId) {
            const ids = new Set(
                question.choiceGroups
                    .find((group) => group.id === groupId)
                    ?.choices.map((choice) => choice.id) ?? []
            );
            return setSelected([
                ...selected.filter((value) => !ids.has(value)),
                id,
            ]);
        }
        if (
            question.type === "Sentence Equivalence" &&
            !selected.includes(id) &&
            selected.length === 2
        )
            return;
        setSelected(
            selected.includes(id)
                ? selected.filter((value) => value !== id)
                : [...selected, id]
        );
    };
    const state = (id: string) => {
        if (!feedback) return "";
        const isCorrectChoice = feedback.correctChoiceIds?.includes(id);
        const isSubmittedChoice = feedback.submittedChoiceIds?.includes(id);
        if (isCorrectChoice || (feedback.correct && isSubmittedChoice))
            return "correct";
        return isSubmittedChoice ? "incorrect" : "";
    };
    if (question.type === "Quantitative Comparison")
        return (
            <div className="qc-input">
                <div className="qc-options">
                    {[
                        ["A", "A > B", "Quantity A is greater."],
                        ["B", "A < B", "Quantity B is greater."],
                        ["C", "A == B", "The quantities are equal."],
                        ["D", "NA", "The relationship cannot be determined."],
                    ].map(([id, symbol, description]) => (
                        <button
                            key={id}
                            disabled={disabled}
                            className={`choice ${
                                selected.includes(id) ? "chosen" : ""
                            } ${state(id)}`}
                            onClick={() => choose(id)}
                        >
                            <span className="choice-key">{id}</span>
                            <span className="qc-option-copy">
                                <b>{symbol}</b>
                                <small>{description}</small>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    if (question.type.startsWith("Numeric Entry")) {
        const fraction = question.type === "Numeric Entry (Fraction)";
        const [numerator = "", denominator = ""] = (selected[0] ?? "/").split(
            "/",
            2
        );
        return (
            <div
                className={`numeric-input ${
                    feedback && !feedback.correct ? "incorrect" : ""
                }`}
            >
                {fraction ? (
                    <div className="fraction-inputs">
                        <input
                            className="numeric-answer-input"
                            aria-label="Numerator"
                            value={numerator}
                            inputMode="numeric"
                            disabled={disabled}
                            onChange={(event) =>
                                setSelected([
                                    `${event.target.value}/${denominator}`,
                                ])
                            }
                        />
                        <span className="fraction-divider" aria-hidden="true" />
                        <input
                            className="numeric-answer-input"
                            aria-label="Denominator"
                            value={denominator}
                            inputMode="numeric"
                            disabled={disabled}
                            onChange={(event) =>
                                setSelected([
                                    `${numerator}/${event.target.value}`,
                                ])
                            }
                        />
                    </div>
                ) : (
                    <label>
                        Enter your answer
                        <input
                            className="numeric-answer-input"
                            value={selected[0] ?? ""}
                            inputMode="decimal"
                            disabled={disabled}
                            onChange={(event) =>
                                setSelected([event.target.value])
                            }
                        />
                    </label>
                )}
            </div>
        );
    }
    const blanks = question.type.startsWith("TC ")
        ? Number(question.type.match(/^TC (\d) Blank$/)?.[1] ?? 1)
        : 0;
    return (
        <div
            className={`choices ${
                blanks ? `text-completion tc-${blanks}` : ""
            }`}
        >
            {question.choiceGroups.map((group) => (
                <section key={group.id}>
                    {group.choices.map((choice) => (
                        <button
                            key={choice.id}
                            disabled={disabled && vocabulary.byTerm.size === 0}
                            aria-disabled={disabled}
                            className={`choice ${
                                selected.includes(choice.id) ? "chosen" : ""
                            } ${state(choice.id)} ${
                                disabled ? "answer-locked" : ""
                            }`}
                            onClick={(event) => {
                                if (disabled) return;
                                if (event.detail === 2) return;
                                choose(choice.id, group.id);
                            }}
                        >
                            <span className="choice-key">{choice.label}</span>
                            <VocabularyHtml
                                value={choice.bodyHtml}
                                vocabulary={vocabulary}
                                onWordDoubleClick={onVocabularyWord}
                            />
                            {state(choice.id) === "correct" && (
                                <Check size={18} />
                            )}
                        </button>
                    ))}
                </section>
            ))}
        </div>
    );
}
function answerResponse(question: Question, selected: string[]) {
    const choices = question.choiceGroups.flatMap((group) => group.choices);
    const labelFor = (id: string) =>
        choices.find((choice) => choice.id === id)?.label ?? id;
    if (question.type === "Multiple Choice")
        return { question_id: question.id, choice: labelFor(selected[0]) };
    if (
        question.type === "Multiple Select" ||
        question.type === "Sentence Equivalence"
    )
        return { question_id: question.id, choices: selected.map(labelFor) };
    if (question.type === "Quantitative Comparison")
        return { question_id: question.id, choice: selected[0] };
    if (question.type === "Numeric Entry (Fraction)") {
        const [numerator, denominator] = String(selected[0] ?? "").split("/");
        return {
            question_id: question.id,
            numerator: Number(numerator),
            denominator: Number(denominator),
        };
    }
    if (question.type === "Numeric Entry (Not Fraction)")
        return { question_id: question.id, value: Number(selected[0]) };
    return Object.assign(
        { question_id: question.id },
        ...question.choiceGroups.map((group, index) => ({
            [`blank_${index + 1}`]: labelFor(
                selected.find((id) =>
                    group.choices.some((choice) => choice.id === id)
                ) ?? ""
            ),
        }))
    );
}
function canSubmitAnswer(question: Question, selected: string[]) {
    if (question.type === "Numeric Entry (Fraction)") {
        const [numerator, denominator] = String(selected[0] ?? "").split("/");
        return (
            /^-?\d+$/.test(numerator) &&
            /^-?\d+$/.test(denominator) &&
            Number(denominator) !== 0
        );
    }
    if (question.type === "Numeric Entry (Not Fraction)")
        return (
            selected.length === 1 &&
            selected[0].trim() !== "" &&
            Number.isFinite(Number(selected[0]))
        );
    if (question.type === "Sentence Equivalence") return selected.length === 2;
    if (question.type.startsWith("TC "))
        return question.choiceGroups.every((group) =>
            selected.some((id) =>
                group.choices.some((choice) => choice.id === id)
            )
        );
    return selected.length > 0;
}
type PracticeProps = {
    catalogs: Catalogs;
    boot: Bootstrap;
    user: any;
    mutate: (url: string, method: string, body: any) => void;
    onBoot: (value: Bootstrap) => void;
};
const solutionKind = (question: Question) =>
    question.solution?.videoId
        ? "video"
        : question.solution?.html?.trim()
        ? "text"
        : "none";
const difficultyRank = (difficulty: Question["difficulty"]) =>
    difficulty === "Easy"
        ? 0
        : difficulty === "Medium"
        ? 1
        : difficulty === "Hard"
        ? 2
        : 3;
type PracticeFilters = {
    category: string;
    difficulty: string;
    type: string;
    filter: string;
    solution: string;
    search: string;
    sort: string;
};
const getPracticeFilters = (): PracticeFilters => ({
    category: getParam("category", ""),
    difficulty: getParam("difficulty", ""),
    type: getParam("type", ""),
    filter: getParam("filter", ""),
    solution: getParam("solution", ""),
    search: getParam("q", ""),
    sort: getParam("sort", "title"),
});
const questionStatus = (
    question: Question,
    attempted: Set<string>,
    completed: Set<string>,
    bookmarked: Set<string>
) =>
    completed.has(question.id)
        ? "Completed"
        : attempted.has(question.id)
        ? "Attempted"
        : bookmarked.has(question.id)
        ? "Saved"
        : "New";
const practiceQuestions = (
    items: Question[],
    filters: PracticeFilters,
    attempted: Set<string>,
    completed: Set<string>,
    bookmarked: Set<string>
) =>
    [
        ...items.filter((question) => {
            const matchesSearch =
                !filters.search ||
                question.title
                    .toLowerCase()
                    .includes(filters.search.toLowerCase());
            const matchesStatus =
                !filters.filter ||
                (filters.filter === "unanswered"
                    ? !attempted.has(question.id)
                    : filters.filter === "attempted"
                    ? attempted.has(question.id) && !completed.has(question.id)
                    : filters.filter === "completed"
                    ? completed.has(question.id)
                    : bookmarked.has(question.id));
            return (
                matchesSearch &&
                (!filters.category || question.category === filters.category) &&
                (!filters.difficulty ||
                    question.difficulty === filters.difficulty) &&
                (!filters.type || question.type === filters.type) &&
                matchesStatus &&
                (!filters.solution ||
                    solutionKind(question) === filters.solution)
            );
        }),
    ].sort((a, b) => {
        const descending = filters.sort.endsWith("-desc") ? -1 : 1;
        const key = filters.sort.replace(/-desc$/, "");
        const aValue =
            key === "category"
                ? a.category ?? ""
                : key === "type"
                ? a.type
                : key === "difficulty"
                ? String(difficultyRank(a.difficulty))
                : key === "solution"
                ? solutionKind(a)
                : key === "status"
                ? questionStatus(a, attempted, completed, bookmarked)
                : a.title;
        const bValue =
            key === "category"
                ? b.category ?? ""
                : key === "type"
                ? b.type
                : key === "difficulty"
                ? String(difficultyRank(b.difficulty))
                : key === "solution"
                ? solutionKind(b)
                : key === "status"
                ? questionStatus(b, attempted, completed, bookmarked)
                : b.title;
        return (
            descending *
            (aValue.localeCompare(bValue) || a.title.localeCompare(b.title))
        );
    });
const navigateToQuestion = (questionId: string, subject?: Subject) => {
    const query = new URLSearchParams(location.search);
    query.set("question", questionId);
    if (subject) query.set("subject", subject);
    history.pushState({}, "", `/practice/question?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
};
const backToPractice = (subject?: Subject) => {
    const query = new URLSearchParams(location.search);
    query.delete("question");
    if (subject) query.set("subject", subject);
    history.pushState({}, "", `/practice?${query}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
};

function Practice({
    catalogs,
    boot,
    user,
    onBoot,
}: {
    catalogs: Catalogs;
    boot: Bootstrap;
    user: any;
    onBoot: (value: Bootstrap) => void;
}) {
    const subject = getParam("subject", "quant") as Subject;
    const filters = getPracticeFilters();
    const hasActiveFilters = Boolean(
        filters.search ||
            filters.category ||
            filters.difficulty ||
            filters.type ||
            filters.filter ||
            filters.solution ||
            filters.sort !== "title"
    );
    const [filtersOpen, setFiltersOpen] = useState(hasActiveFilters);
    useEffect(() => {
        if (hasActiveFilters) setFiltersOpen(true);
    }, [hasActiveFilters]);
    const attempted = new Set(
            boot.attempts.map((attempt) => attempt.questionId)
        ),
        completed = new Set(
            boot.attempts
                .filter((attempt) => Boolean(attempt.correct))
                .map((attempt) => attempt.questionId)
        ),
        bookmarked = new Set(
            boot.bookmarks.map((bookmark) => bookmark.questionId)
        );
    const categories = [
        ...new Set(
            catalogs.questions[subject]
                .map((question) => question.category)
                .filter(Boolean) as string[]
        ),
    ].sort();
    const types = [
        ...new Set(
            catalogs.questions[subject].map((question) => question.type)
        ),
    ].sort();
    const questions = practiceQuestions(
        catalogs.questions[subject],
        filters,
        attempted,
        completed,
        bookmarked
    );
    const [resetMessage, setResetMessage] = useState("");
    const clearFilters = () => {
        setFiltersOpen(false);
        setParams({
            q: undefined,
            category: undefined,
            difficulty: undefined,
            type: undefined,
            filter: undefined,
            solution: undefined,
            sort: undefined,
        });
    };
    const switchSubject = (next: Subject) => {
        setResetMessage("");
        setFiltersOpen(false);
        setParams({
            subject: next,
            question: undefined,
            q: undefined,
            category: undefined,
            difficulty: undefined,
            type: undefined,
            filter: undefined,
            solution: undefined,
            sort: undefined,
        });
    };
    const pickRandom = () => {
        const item = questions[Math.floor(Math.random() * questions.length)];
        if (item) navigateToQuestion(item.id, subject);
    };
    const toggleSort = (key: string) => {
        const next =
            filters.sort === key
                ? `${key}-desc`
                : filters.sort === `${key}-desc`
                ? key
                : key;
        setParams({ sort: next === "title" ? undefined : next });
    };
    const resetProgress = async () => {
        if (!user) {
            setResetMessage("Sign in to reset saved progress.");
            return;
        }
        if (
            !confirm(
                `Reset all ${
                    subject === "quant" ? "Quant" : "Verbal"
                } progress? This removes saved lesson progress, attempts, and bookmarks for this subject.`
            )
        )
            return;
        try {
            await api(`/api/me/progress/${subject}`, { method: "DELETE" });
            onBoot({
                ...boot,
                videos: boot.videos.filter(
                    (item) => !item.videoId.startsWith(`${subject}:`)
                ),
                attempts: boot.attempts.filter(
                    (item) => !item.questionId.startsWith(`${subject}:`)
                ),
                bookmarks: boot.bookmarks.filter(
                    (item) => !item.questionId.startsWith(`${subject}:`)
                ),
                memorizeProgress: boot.memorizeProgress.filter(
                    (item) =>
                        subject === "quant"
                            ? item.source !== "quant" &&
                              item.source !== "quant-overwhelmed"
                            : item.source !== "verbal"
                ),
            });
            try {
                const prefixes =
                    subject === "quant"
                        ? ["memorize:quant:", "memorize:quant-overwhelmed:"]
                        : ["memorize:verbal:"];
                Object.keys(localStorage).forEach((key) => {
                    if (prefixes.some((prefix) => key.startsWith(prefix))) {
                        localStorage.removeItem(key);
                    }
                });
            } catch {}
            setResetMessage(
                `${subject === "quant" ? "Quant" : "Verbal"} progress reset.`
            );
        } catch (error: any) {
            setResetMessage(error.message);
        }
    };
    const activeSort = filters.sort.replace(/-desc$/, "");
    const sortHeader = (label: string, key: string) => {
        const active = activeSort === key;
        return (
            <th
                scope="col"
                aria-sort={
                    active
                        ? filters.sort.endsWith("-desc")
                            ? "descending"
                            : "ascending"
                        : "none"
                }
            >
                <button
                    className={`table-sort ${active ? "active" : ""}`}
                    onClick={() => toggleSort(key)}
                >
                    {label}
                    <ChevronDown
                        className={`sort-chevron ${
                            active && filters.sort.endsWith("-desc")
                                ? "descending"
                                : ""
                        } ${active ? "active" : ""}`}
                        size={14}
                    />
                </button>
            </th>
        );
    };
    return (
        <>
            <section className="practice-title">
                <div>
                    <h1>Practice questions</h1>
                    <p>
                        Find the right problem, then work it without
                        distractions.
                    </p>
                </div>
                <div className="practice-actions">
                    <div
                        className="subject-switch"
                        aria-label="Practice subject"
                    >
                        <button
                            className={subject === "quant" ? "selected" : ""}
                            onClick={() => switchSubject("quant")}
                        >
                            Quant
                        </button>
                        <button
                            className={subject === "verbal" ? "selected" : ""}
                            onClick={() => switchSubject("verbal")}
                        >
                            Verbal
                        </button>
                    </div>
                    <button
                        className="random-problem"
                        disabled={!questions.length}
                        onClick={pickRandom}
                    >
                        <Sparkles size={16} /> Random question
                    </button>
                </div>
            </section>
            <button
                type="button"
                className={`mobile-filter-toggle ${
                    hasActiveFilters ? "has-active" : ""
                }`}
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                aria-controls="question-filters"
            >
                <SlidersHorizontal size={18} />
                Filters{hasActiveFilters ? " (active)" : ""}
            </button>
            <section
                id="question-filters"
                className={`problem-controls ${filtersOpen ? "is-open" : ""}`}
                aria-label="Question filters"
            >
                <label className="question-search">
                    <span>Search</span>
                    <div>
                        <Search size={16} />
                        <input
                            value={filters.search}
                            onChange={(event) =>
                                setParams({
                                    q: event.target.value || undefined,
                                })
                            }
                            placeholder="Search question titles"
                            aria-label="Search question titles"
                        />
                    </div>
                </label>
                {categories.length > 0 && (
                    <label>
                        Category
                        <select
                            value={filters.category}
                            onChange={(event) =>
                                setParams({
                                    category: event.target.value || undefined,
                                })
                            }
                        >
                            <option value="">All categories</option>
                            {categories.map((item) => (
                                <option key={item}>{item}</option>
                            ))}
                        </select>
                    </label>
                )}
                <label>
                    Difficulty
                    <select
                        value={filters.difficulty}
                        onChange={(event) =>
                            setParams({
                                difficulty: event.target.value || undefined,
                            })
                        }
                    >
                        <option value="">All difficulties</option>
                        <option>Easy</option>
                        <option>Medium</option>
                        <option>Hard</option>
                    </select>
                </label>
                <label>
                    Question type
                    <select
                        value={filters.type}
                        onChange={(event) =>
                            setParams({ type: event.target.value || undefined })
                        }
                    >
                        <option value="">All types</option>
                        {types.map((item) => (
                            <option key={item}>{item}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Status
                    <select
                        value={filters.filter}
                        onChange={(event) =>
                            setParams({
                                filter: event.target.value || undefined,
                            })
                        }
                    >
                        <option value="">All statuses</option>
                        <option value="unanswered">Not started</option>
                        <option value="attempted">Attempted</option>
                        <option value="completed">Completed</option>
                        <option value="bookmarked">Bookmarked</option>
                    </select>
                </label>
                <label>
                    Solution
                    <select
                        value={filters.solution}
                        onChange={(event) =>
                            setParams({
                                solution: event.target.value || undefined,
                            })
                        }
                    >
                        <option value="">Any solution</option>
                        <option value="none">No solution</option>
                        <option value="text">Written solution</option>
                        <option value="video">Video solution</option>
                    </select>
                </label>
                <div className="filter-actions">
                    <button className="clear-filters" onClick={clearFilters}>
                        Clear filters
                    </button>
                    <button className="reset-progress" onClick={resetProgress}>
                        Reset {subject === "quant" ? "Quant" : "Verbal"}{" "}
                        progress
                    </button>
                </div>
            </section>
            {resetMessage && (
                <p className="reset-message" role="status">
                    {resetMessage}
                </p>
            )}
            <div className="problem-summary">
                <span>
                    {questions.length} question
                    {questions.length === 1 ? "" : "s"} found
                </span>
                <span>
                    {attempted.size} attempted · {bookmarked.size} bookmarked
                </span>
            </div>
            {questions.length ? (
                <>
                <section
                    className="problem-list question-table"
                    aria-label="Available questions"
                >
                    <table>
                        <thead>
                            <tr>
                                {sortHeader("Question", "title")}
                                {categories.length > 0 &&
                                    sortHeader("Category", "category")}
                                {sortHeader("Type", "type")}
                                {sortHeader("Difficulty", "difficulty")}
                                {sortHeader("Solution", "solution")}
                                {sortHeader("Status", "status")}
                                <th scope="col">
                                    <span className="sr-only">Open</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {questions.map((question) => {
                                const status = questionStatus(
                                    question,
                                    attempted,
                                    completed,
                                    bookmarked
                                );
                                const solution = solutionKind(question);
                                return (
                                    <tr
                                        key={question.id}
                                        tabIndex={0}
                                        role="link"
                                        aria-label={`Open ${question.title}`}
                                        onClick={() =>
                                            navigateToQuestion(
                                                question.id,
                                                subject
                                            )
                                        }
                                        onKeyDown={(event) => {
                                            if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                            ) {
                                                event.preventDefault();
                                                navigateToQuestion(
                                                    question.id,
                                                    subject
                                                );
                                            }
                                        }}
                                    >
                                        <td className="question-title-cell">
                                            <MathText value={question.title} />
                                        </td>
                                        {categories.length > 0 && (
                                            <td>{question.category ?? "—"}</td>
                                        )}
                                        <td>
                                            <MathText value={question.type} />
                                        </td>
                                        <td>
                                            <span
                                                className={`difficulty ${(
                                                    question.difficulty ??
                                                    "mixed"
                                                ).toLowerCase()}`}
                                            >
                                                {question.difficulty ?? "Mixed"}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={`solution-status ${solution}`}
                                            >
                                                {solution === "none"
                                                    ? "None"
                                                    : solution === "video"
                                                    ? "Video"
                                                    : "Written"}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={`status-dot ${status.toLowerCase()}`}
                                            />
                                            <span className="status-text">
                                                {status}
                                            </span>
                                        </td>
                                        <td>
                                            <ChevronRight
                                                className="table-open"
                                                size={18}
                                                aria-hidden="true"
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </section>
                <ol className="question-cards" aria-label="Available questions">
                    {questions.map((question) => {
                        const status = questionStatus(
                            question,
                            attempted,
                            completed,
                            bookmarked
                        );
                        const solution = solutionKind(question);
                        return (
                            <li key={question.id}>
                                <button
                                    className="question-card"
                                    onClick={() =>
                                        navigateToQuestion(
                                            question.id,
                                            subject
                                        )
                                    }
                                    aria-label={`Open ${question.title} — ${status}, ${question.difficulty ?? "Mixed"}`}
                                >
                                    <span className="question-card-title">
                                        <MathText value={question.title} />
                                    </span>
                                    <span className="question-card-meta">
                                        <span
                                            className={`difficulty ${(
                                                question.difficulty ?? "mixed"
                                            ).toLowerCase()}`}
                                        >
                                            {question.difficulty ?? "Mixed"}
                                        </span>
                                        <span
                                            className={`solution-status ${solution}`}
                                        >
                                            {solution === "none"
                                                ? "No solution"
                                                : solution === "video"
                                                ? "Video"
                                                : "Written"}
                                        </span>
                                        <span className="question-status-tag">
                                            <span
                                                className={`status-dot ${status.toLowerCase()}`}
                                            />
                                            {status}
                                        </span>
                                    </span>
                                    {question.category && (
                                        <span className="question-card-cat">
                                            {question.category} ·{" "}
                                            {questionTypeTag(question.type) ??
                                                question.type}
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ol>
                </>
            ) : (
                <section className="empty question-empty">
                    <BookOpen size={30} />
                    <h2>No questions match these filters.</h2>
                    <p>
                        Clear a filter or choose another subject to see more
                        questions.
                    </p>
                    <button className="clear-filters" onClick={clearFilters}>
                        Clear filters
                    </button>
                </section>
            )}
        </>
    );
}

const questionTypeTag = (type: Question["type"]) =>
    ((
        {
            "Multiple Choice": "MC",
            "Multiple Select": "MS",
            "Quantitative Comparison": "QC",
            "Sentence Equivalence": "SE",
            "TC 1 Blank": "TC-1",
            "TC 2 Blank": "TC-2",
            "TC 3 Blank": "TC-3",
            "Numeric Entry (Fraction)": "FRAC",
            "Numeric Entry (Not Fraction)": "NUM",
        } as Record<Question["type"], string>
    )[type]);

function PracticeQuestion({
    catalogs,
    boot,
    user,
    mutate,
    onBoot,
}: PracticeProps) {
    const subject = getParam("subject", "quant") as Subject;
    const requestedQuestionId = getParam("question", "");
    const question =
        catalogs.questions[subject].find(
            (item) => item.id === requestedQuestionId
        ) ??
        (["quant", "verbal"] as Subject[])
            .flatMap((item) => catalogs.questions[item])
            .find((item) => item.id === requestedQuestionId);
    const questionSubject = question?.subject ?? subject;
    const [selected, setSelected] = useState<string[]>([]),
        [feedback, setFeedback] = useState<any>(null),
        [solutionOpen, setSolutionOpen] = useState(false);
    const [verbalVocabulary, setVerbalVocabulary] =
        useState<VocabularyIndex>(emptyVocabularyIndex);
    const [vocabularyPopup, setVocabularyPopup] = useState<{
        item: MountainItem;
        top: number;
        left: number;
    } | null>(null);
    const vocabularyPopupRef = useRef<HTMLDivElement>(null);
    const attempted = new Set(boot.attempts.map((item) => item.questionId)),
        completed = new Set(
            boot.attempts
                .filter((item) => Boolean(item.correct))
                .map((item) => item.questionId)
        ),
        bookmarked = new Set(boot.bookmarks.map((item) => item.questionId));
    const subjectQuestions = question
        ? practiceQuestions(
              catalogs.questions[questionSubject],
              getPracticeFilters(),
              attempted,
              completed,
              bookmarked
          )
        : [];
    const questionIndex = question
        ? subjectQuestions.findIndex((item) => item.id === question.id)
        : -1;
    const canSubmit = question ? canSubmitAnswer(question, selected) : false;
    useEffect(() => {
        setSelected([]);
        setFeedback(null);
        setSolutionOpen(false);
        setVocabularyPopup(null);
    }, [question?.id]);
    useEffect(() => {
        if (questionSubject !== "verbal") {
            setVerbalVocabulary(emptyVocabularyIndex());
            return;
        }
        let cancelled = false;
        fetch("/data/vocab_mountain.json")
            .then((response) => {
                if (!response.ok) throw new Error("Vocabulary unavailable");
                return response.json() as Promise<MountainData>;
            })
            .then((data) => {
                if (!cancelled) setVerbalVocabulary(createVocabularyIndex(data));
            })
            .catch(() => {
                if (!cancelled) setVerbalVocabulary(emptyVocabularyIndex());
            });
        return () => {
            cancelled = true;
        };
    }, [questionSubject]);
    useEffect(() => {
        if (!vocabularyPopup) return;
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (
                !(target instanceof Node) ||
                !vocabularyPopupRef.current?.contains(target)
            ) {
                setVocabularyPopup(null);
            }
        };
        document.addEventListener("pointerdown", closeOnOutsidePointer);
        return () =>
            document.removeEventListener("pointerdown", closeOnOutsidePointer);
    }, [vocabularyPopup]);
    const openVocabularyPopup = (item: MountainItem, anchor: HTMLElement) => {
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(360, window.innerWidth - 24);
        const height = Math.min(360, window.innerHeight * 0.65);
        const gap = 8;
        const left = Math.max(
            12,
            Math.min(rect.left, window.innerWidth - width - 12)
        );
        const below = rect.bottom + gap;
        const top = Math.max(
            12,
            Math.min(
                below + height <= window.innerHeight - 12
                    ? below
                    : rect.top - height - gap,
                window.innerHeight - height - 12
            )
        );
        setVocabularyPopup({ item, top, left });
    };
    const submit = async () => {
        if (!question) return;
        if (!user) return setFeedback({ needLogin: true });
        try {
            const value = await api(
                `/api/me/questions/${encodeURIComponent(question.id)}/attempts`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        selectedChoiceIds: selected,
                        response: answerResponse(question, selected),
                        idempotencyKey: newIdempotencyKey(),
                    }),
                }
            );
            setFeedback({ ...value, submittedChoiceIds: [...selected] });
            onBoot({
                ...boot,
                attempts: [
                    {
                        questionId: question.id,
                        correct: Number(value.correct),
                        score: value.score,
                        submittedAt: new Date().toISOString(),
                    },
                    ...boot.attempts,
                ],
            });
        } catch (error: any) {
            setFeedback({ error: error.message });
        }
    };
    const toggleBookmark = () => {
        if (!question) return;
        const value = !bookmarked.has(question.id);
        mutate(
            `/api/me/questions/${encodeURIComponent(question.id)}/bookmark`,
            `PUT`,
            { bookmarked: value }
        );
        onBoot({
            ...boot,
            bookmarks: value
                ? [...boot.bookmarks, { questionId: question.id }]
                : boot.bookmarks.filter(
                      (item) => item.questionId !== question.id
                  ),
        });
    };
    useEffect(() => {
        if (!question) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey
            )
                return;
            const target = event.target as HTMLElement | null;
            const isTyping = Boolean(
                target?.matches(
                    "input, textarea, select, [contenteditable=true]"
                )
            );
            const numericInputs = [
                ...document.querySelectorAll<HTMLInputElement>(
                    ".question-focus .numeric-answer-input:not(:disabled)"
                ),
            ];
            if (event.key === "Enter") {
                if (numericInputs.length) {
                    const index = numericInputs.indexOf(
                        target as HTMLInputElement
                    );
                    event.preventDefault();
                    if (index < numericInputs.length - 1) {
                        numericInputs[Math.max(0, index + 1)]?.focus();
                    } else if (canSubmit && !feedback?.correct) {
                        submit();
                    }
                    return;
                }
                if (!isTyping && canSubmit && !feedback?.correct) {
                    event.preventDefault();
                    submit();
                }
                return;
            }
            if (isTyping) return;
            if (target?.closest(".solution-dialog-backdrop")) {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    if (!target.closest(".vjs-slider")) {
                        event.preventDefault();
                        skipVideo(
                            document.querySelector<HTMLVideoElement>(
                                ".solution-dialog video"
                            ),
                            event.key === "ArrowRight" ? 10 : -10
                        );
                    }
                }
                return;
            }
            if (event.key.toLowerCase() === "b") {
                event.preventDefault();
                toggleBookmark();
                return;
            }
            if (event.key === " ") {
                event.preventDefault();
                setSolutionOpen(true);
                return;
            }
            if (
                event.key === "ArrowRight" &&
                subjectQuestions[questionIndex + 1]
            ) {
                event.preventDefault();
                navigateToQuestion(
                    subjectQuestions[questionIndex + 1].id,
                    questionSubject
                );
                return;
            }
            if (
                event.key === "ArrowLeft" &&
                subjectQuestions[questionIndex - 1]
            ) {
                event.preventDefault();
                navigateToQuestion(
                    subjectQuestions[questionIndex - 1].id,
                    questionSubject
                );
                return;
            }
            const keys = [
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                "a",
                "s",
                "d",
                "f",
                "g",
                "h",
                "j",
                "k",
                "l",
            ];
            const index = keys.indexOf(event.key.toLowerCase());
            const choice = [
                ...document.querySelectorAll<HTMLButtonElement>(
                    ".question-focus .choice:not(:disabled)"
                ),
            ][index % 9];
            if (index >= 0 && choice) {
                event.preventDefault();
                choice.click();
            }
        };
        addEventListener("keydown", onKeyDown);
        return () => removeEventListener("keydown", onKeyDown);
    }, [
        question?.id,
        questionIndex,
        selected,
        canSubmit,
        feedback?.correct,
        subjectQuestions,
    ]);
    if (!question)
        return (
            <section className="empty question-empty">
                <BookOpen size={30} />
                <h1>Question unavailable</h1>
                <p>It may no longer be available in this subject.</p>
                <button
                    className="clear-filters"
                    onClick={() => backToPractice(questionSubject)}
                >
                    Back to questions
                </button>
            </section>
        );
    return (
        <article className="question-workspace question-focus">
            <h1 className="sr-only">
                <MathText value={question.title} />
            </h1>
            <div className="question-nav">
                <button
                    className="previous-question"
                    disabled={questionIndex <= 0}
                    onClick={() =>
                        subjectQuestions[questionIndex - 1] &&
                        navigateToQuestion(
                            subjectQuestions[questionIndex - 1].id,
                            questionSubject
                        )
                    }
                >
                    <ChevronLeft size={16} /> Previous
                </button>
                {questionIndex >= 0 && (
                    <span className="question-position">
                        {questionIndex + 1} of {subjectQuestions.length}
                    </span>
                )}
                <button
                    className="next-question"
                    disabled={
                        questionIndex < 0 ||
                        questionIndex >= subjectQuestions.length - 1
                    }
                    onClick={() =>
                        subjectQuestions[questionIndex + 1] &&
                        navigateToQuestion(
                            subjectQuestions[questionIndex + 1].id,
                            questionSubject
                        )
                    }
                >
                    Next <ChevronRight size={16} />
                </button>
            </div>
            <header className="question-card-topline">
                <button
                    className="back-to-questions"
                    onClick={() => backToPractice(questionSubject)}
                >
                    <ChevronLeft size={18} /> All questions
                </button>
                <div className="question-feedback">
                    {feedback && <Feedback feedback={feedback} />}
                </div>
                <div className="question-page-meta">
                    <span
                        className={`question-status-tag ${questionStatus(
                            question,
                            attempted,
                            completed,
                            bookmarked
                        ).toLowerCase()}`}
                    >
                        {questionStatus(
                            question,
                            attempted,
                            completed,
                            bookmarked
                        ) === "Completed"
                            ? "Solved"
                            : questionStatus(
                                  question,
                                  attempted,
                                  completed,
                                  bookmarked
                              )}
                    </span>
                    <span className="question-status-tag">
                        {questionTypeTag(question.type)}
                    </span>
                    <span
                        className={`difficulty ${(
                            question.difficulty ?? "mixed"
                        ).toLowerCase()}`}
                    >
                        {question.difficulty ?? "Mixed"}
                    </span>
                </div>
                <button className="bookmark" onClick={toggleBookmark}>
                    {bookmarked.has(question.id) ? "Bookmarked" : "Bookmark"}{" "}
                    <kbd>B</kbd>
                </button>
            </header>
            <div className="question-layout">
                <section
                    className="question-prompt"
                    aria-label="Question prompt"
                >
                    <VocabularyHtml
                        value={question.promptHtml}
                        vocabulary={verbalVocabulary}
                        onWordClick={openVocabularyPopup}
                    />
                    {question.image && (
                        <div className="question-image">
                            <img
                                src={`/api/media/question-image/${encodeURIComponent(
                                    question.image
                                )}?subject=${questionSubject}`}
                                alt={question.title}
                            />
                        </div>
                    )}
                    {question.type === "Quantitative Comparison" ? (
                        <div className="qc-columns">
                            {question.choiceGroups[0]?.choices.map((choice) => (
                                <section key={choice.id}>
                                    <strong>Quantity {choice.label}</strong>
                                    <Html value={choice.bodyHtml} />
                                </section>
                            ))}
                        </div>
                    ) : null}
                </section>
                <section
                    className="question-answer"
                    aria-label="Answer options"
                >
                    <QuestionInputs
                        question={question}
                        selected={selected}
                        setSelected={setSelected}
                        feedback={feedback}
                        vocabulary={verbalVocabulary}
                        onVocabularyWord={openVocabularyPopup}
                    />
                    <div className="question-actions">
                        <button
                            className="solution-button"
                            onClick={() => setSolutionOpen(true)}
                        >
                            Show solution <kbd>Space</kbd>
                        </button>
                        <button
                            className="primary submit"
                            disabled={!canSubmit || Boolean(feedback?.correct)}
                            onClick={submit}
                        >
                            {completed.has(question.id)
                                ? "Solve again"
                                : "Submit answer"}{" "}
                            <kbd>Enter</kbd>
                        </button>
                    </div>
                </section>
            </div>
            {solutionOpen && (
                <SolutionModal
                    solution={question.solution}
                    subject={questionSubject}
                    onClose={() => setSolutionOpen(false)}
                />
            )}
            {vocabularyPopup && (
                <div
                    ref={vocabularyPopupRef}
                    className="vocab-definition-popup"
                    style={{
                        top: vocabularyPopup.top,
                        left: vocabularyPopup.left,
                    }}
                    role="dialog"
                    aria-label={`${vocabularyPopup.item.title} definition`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="vocab-popup-header">
                        <strong>{vocabularyPopup.item.title}</strong>
                        <button
                            type="button"
                            className="vocab-popup-close"
                            aria-label="Close definition"
                            onClick={() => setVocabularyPopup(null)}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <Html value={vocabularyPopup.item.description} />
                </div>
            )}
        </article>
    );
}

function Feedback({ feedback }: { feedback: any }) {
    if (feedback.needLogin)
        return (
            <div className="feedback neutral">
                <strong>Sign in to record your attempts.</strong>
                <p>Open the Account tab, then return to submit.</p>
            </div>
        );
    if (feedback.error)
        return (
            <div className="feedback incorrect">
                <strong>Couldn’t submit</strong>
                <p>{feedback.error}</p>
            </div>
        );
    return (
        <div
            className={`feedback ${feedback.correct ? "correct" : "incorrect"}`}
        >
            <strong>{feedback.correct ? "Correct." : "Not quite."}</strong>
        </div>
    );
}
function SolutionPlayer({ src }: { src: string }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [buffering, setBuffering] = useState(false);
    const seekFeedback = useVideoSeekFeedback("solution");
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let disposed = false;
        let player: any;
        setBuffering(false);
        loadVideojs().then((videojs) => {
            if (disposed) return;
            const element = document.createElement("video-js");
            host.appendChild(element);
            player = videojs(element, {
                controls: true,
                preload: "metadata",
                playsinline: true,
                aspectRatio: "16:9",
                playbackRates: [0.75, 1, 1.25, 1.5, 1.75, 2],
            });
            player.ready(() => {
                const media = player.el().querySelector("video");
                media?.setAttribute("playsinline", "true");
                media?.setAttribute("webkit-playsinline", "true");
            });
            player.on("waiting", () => setBuffering(true));
            player.on("playing", () => setBuffering(false));
            player.on("canplay", () => setBuffering(false));
            player.on("pause", () => setBuffering(false));
            player.on("error", () => setBuffering(false));
            player.src({ src, type: "video/mp4" });
        });
        return () => {
            disposed = true;
            setBuffering(false);
            player?.dispose();
        };
    }, [src]);
    return (
        <div
            className={`solution-video-player ${buffering ? "is-buffering" : ""}`}
            aria-busy={buffering}
        >
            <div ref={hostRef} />
            {buffering && (
                <span className="video-buffering" role="status" aria-label="Buffering">
                    <span className="video-buffering-spinner" />
                </span>
            )}
            {seekFeedback && (
                <span
                    key={`${seekFeedback.direction}-${seekFeedback.seconds}`}
                    className={`video-seek-feedback ${seekFeedback.direction}`}
                    role="status"
                    aria-live="polite"
                >
                    {seekFeedback.direction === "forward" ? (
                        <FastForward size={20} aria-hidden="true" />
                    ) : (
                        <Rewind size={20} aria-hidden="true" />
                    )}
                    <strong>{seekFeedback.seconds}s</strong>
                </span>
            )}
        </div>
    );
}
function SolutionModal({
    solution,
    subject,
    onClose,
}: {
    solution: Question["solution"];
    subject: Subject;
    onClose: () => void;
}) {
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        addEventListener("keydown", closeOnEscape);
        return () => removeEventListener("keydown", closeOnEscape);
    }, [onClose]);
    const hasVideo = Boolean(solution?.videoId),
        hasBody = Boolean(solution?.html?.trim());
    return (
        <div
            className="solution-dialog-backdrop"
            role="presentation"
            onMouseDown={onClose}
        >
            <section
                className="solution-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="solution-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header>
                    <h2 id="solution-title">Work through the answer</h2>
                    <button
                        className="solution-close"
                        aria-label="Close solution"
                        autoFocus
                        onClick={onClose}
                    >
                        <X size={20} />
                    </button>
                </header>
                <div className="solution-dialog-content">
                    {hasVideo && (
                        <SolutionPlayer
                            src={`/api/media/solution/${solution.videoId}?subject=${subject}`}
                        />
                    )}{" "}
                    {hasBody && <Html value={solution.html} />}{" "}
                    {!hasVideo && !hasBody && (
                        <p className="solution-empty">
                            A solution has not been published for this problem
                            yet.
                        </p>
                    )}
                </div>
            </section>
        </div>
    );
}
function ThemeSettings({
    theme,
    onTheme,
}: {
    theme: Theme;
    onTheme: (theme: Theme) => void;
}) {
    const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
        { value: "auto", label: "Auto", icon: Monitor },
        { value: "light", label: "Light", icon: Sun },
        { value: "dark", label: "Dark", icon: Moon },
    ];
    return (
        <div className="account-card account-settings">
            <div>
                <span className="section-label">Preferences</span>
                <h2>Appearance</h2>
                <p>Choose how GRE Study Desk looks on this device.</p>
            </div>
            <div className="theme-options" role="radiogroup" aria-label="Color theme">
                {options.map(({ value, label, icon: Icon }) => (
                    <button
                        key={value}
                        type="button"
                        className={theme === value ? "selected" : ""}
                        onClick={() => onTheme(value)}
                        role="radio"
                        aria-checked={theme === value}
                    >
                        <Icon size={18} aria-hidden="true" />
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Account({
    user,
    onUser,
    onBoot,
    theme,
    onTheme,
}: {
    user: any;
    onUser: (u: any) => void;
    onBoot: (b: Bootstrap) => void;
    theme: Theme;
    onTheme: (theme: Theme) => void;
}) {
    const [mode, setMode] = useState<"login" | "register">("login"),
        [username, setUsername] = useState(""),
        [password, setPassword] = useState(""),
        [error, setError] = useState("");
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const result = await api(`/api/auth/${mode}`, {
                method: "POST",
                body: JSON.stringify({ username, password }),
            });
            onUser(result.user);
            onBoot(await api("/api/me/bootstrap"));
        } catch (e: any) {
            setError(e.message);
        }
    };
    if (user)
        return (
            <section className="account">
                <h1>Account</h1>
                <div className="account-card">
                    <CircleUserRound size={30} />
                    <h2>{user.username}</h2>
                    <p>Your progress syncs on the next connected session.</p>
                    <button
                        className="text-button danger"
                        onClick={async () => {
                            await api("/api/auth/logout", { method: "POST" });
                            onUser(null);
                        }}
                    >
                        <LogOut size={17} /> Log out
                    </button>
                </div>
                <ThemeSettings theme={theme} onTheme={onTheme} />
            </section>
        );
    return (
        <section className="account">
            <h1>Save your progress</h1>
            <p className="account-lede">
                A simple account keeps your course progress and attempts
                together across devices.
            </p>
            <form className="account-card" onSubmit={submit}>
                <div className="tabs">
                    <button
                        type="button"
                        className={mode === "login" ? "selected" : ""}
                        onClick={() => setMode("login")}
                    >
                        Log in
                    </button>
                    <button
                        type="button"
                        className={mode === "register" ? "selected" : ""}
                        onClick={() => setMode("register")}
                    >
                        Create account
                    </button>
                </div>
                <label>
                    Username
                    <input
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        minLength={3}
                    />
                </label>
                <label>
                    Password
                    <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={10}
                    />
                </label>
                {error && <p className="form-error">{error}</p>}
                <button className="primary">
                    {mode === "login" ? "Log in" : "Create account"}
                </button>
            </form>
            <ThemeSettings theme={theme} onTheme={onTheme} />
        </section>
    );
}
function Empty({ label }: { label: string }) {
    return (
        <section className="empty">
            <BookOpen size={30} />
            <h1>Nothing to show yet</h1>
            <p>{label}</p>
        </section>
    );
}
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
