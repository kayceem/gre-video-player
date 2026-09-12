import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    Filter,
    RotateCcw,
    Shuffle,
    SlidersHorizontal,
    SortAsc,
    Volume2,
    X,
} from "lucide-react";
import type {
    FilterOption,
    ItemStatus,
    MountainData,
    MountainItem,
    MountainSource,
    SortOption,
} from "./mountain-types";
import { Html } from "./main";

const SOURCE_CONFIGS: Array<{
    id: MountainSource;
    label: string;
    description: string;
    file: string;
}> = [
    {
        id: "verbal",
        label: "Verbal Mountain",
        description: "34 Groups of GRE Vocabulary words",
        file: "/data/vocab_mountain.json",
    },
    {
        id: "quant",
        label: "Quant Mountain",
        description: "17 Groups of Math concepts and formulas",
        file: "/data/quant_mountain.json",
    },
    {
        id: "quant-overwhelmed",
        label: "Quant Overwhelmed",
        description: "48 Bite-sized Math groups for structured learning",
        file: "/data/quant_mountain_overwhelmed.json",
    },
];

function getUrlSource(): MountainSource {
    try {
        const param = new URLSearchParams(window.location.search).get("source");
        if (param === "quant" || param === "quant-overwhelmed" || param === "verbal") {
            return param as MountainSource;
        }
    } catch {}
    return "verbal";
}

function getStoredStatus(
    source: MountainSource,
    groupSlug: string,
    itemSlug: string
): ItemStatus {
    try {
        const val = localStorage.getItem(
            `memorize:${source}:${groupSlug}:${itemSlug}`
        );
        return val === "G" || val === "R" ? val : null;
    } catch {
        return null;
    }
}

function setStoredStatus(
    source: MountainSource,
    groupSlug: string,
    itemSlug: string,
    status: ItemStatus
) {
    try {
        const key = `memorize:${source}:${groupSlug}:${itemSlug}`;
        if (status) {
            localStorage.setItem(key, status);
        } else {
            localStorage.removeItem(key);
        }
    } catch {}
}

type SyncedMemorizeProgress = {
    source: MountainSource;
    groupSlug: string;
    itemSlug: string;
    status: Exclude<ItemStatus, null>;
};
type MemorizeProps = {
    user: { id: string } | null;
    progress: SyncedMemorizeProgress[];
    mutate: (url: string, method: string, body: unknown) => void;
    onProgress: (progress: SyncedMemorizeProgress[]) => void;
};
const progressKey = (
    source: MountainSource,
    groupSlug: string,
    itemSlug: string
) => `${source}:${groupSlug}:${itemSlug}`;

export function Memorize({
    user,
    progress,
    mutate,
    onProgress,
}: MemorizeProps) {
    const [source, setSource] = useState<MountainSource>(getUrlSource);

    // Sync source state when URL query params change (e.g. from navbar selector)
    useEffect(() => {
        const handlePopState = () => {
            setSource(getUrlSource());
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    const [dataCache, setDataCache] = useState<
        Partial<Record<MountainSource, MountainData>>
    >({});
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [selectedCategorySlug, setSelectedCategorySlug] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(0);

    // View Mode: "list" (single column layout) or "detail" (full definition page)
    const [viewMode, setViewMode] = useState<"list" | "detail">("list");

    // Controls & Toggles (definition shown by default)
    const [showDefinition, setShowDefinition] = useState<boolean>(() => {
        try {
            const stored = localStorage.getItem("memorize:show-def");
            return stored === null ? true : stored === "true";
        } catch {
            return true;
        }
    });
    const [sortOption, setSortOption] = useState<SortOption>("default");
    const [filterOption, setFilterOption] = useState<FilterOption>("all");
    const [isShuffled, setIsShuffled] = useState<boolean>(false);
    const [shuffleSeed, setShuffleSeed] = useState<number>(0);
    const [filtersOpen, setFiltersOpen] = useState(false);

    // Explicitly revealed items in current session (when D is pressed)
    const [revealedItems, setRevealedItems] = useState<Set<string>>(new Set());

    // Status mapping state (itemSlug -> status)
    const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});

    const currentAudioRef = useRef<HTMLAudioElement | null>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
    const touchStartX = useRef<number | null>(null);
    const syncedLocalKeys = useRef(new Set<string>());
    const hasActiveFilters =
        filterOption !== "all" || sortOption !== "default" || isShuffled;

    useEffect(() => {
        if (hasActiveFilters) setFiltersOpen(true);
    }, [hasActiveFilters]);
    useEffect(() => {
        syncedLocalKeys.current.clear();
    }, [user?.id]);

    // Save show definition toggle
    useEffect(() => {
        try {
            localStorage.setItem("memorize:show-def", String(showDefinition));
        } catch {}
    }, [showDefinition]);

    // Load data for active source
    useEffect(() => {
        if (dataCache[source]) {
            return;
        }
        setLoading(true);
        setError(null);
        const config = SOURCE_CONFIGS.find((s) => s.id === source)!;

        fetch(config.file)
            .then((res) => {
                if (!res.ok) throw new Error(`Failed to load ${config.label}`);
                return res.json();
            })
            .then((data: MountainData) => {
                setDataCache((prev) => ({ ...prev, [source]: data }));
                setLoading(false);
            })
            .catch((err) => {
                setError(err.message || "Failed to load data");
                setLoading(false);
            });
    }, [source, dataCache]);

    const activeData = dataCache[source];

    // Initialize or restore category slug
    useEffect(() => {
        if (!activeData || !activeData.mountain_categories.length) return;
        try {
            const savedCat = localStorage.getItem(`memorize:last-cat:${source}`);
            const exists = activeData.mountain_categories.some(
                (c) => c.slug === savedCat
            );
            if (savedCat && exists) {
                setSelectedCategorySlug(savedCat);
            } else {
                setSelectedCategorySlug(activeData.mountain_categories[0].slug);
            }
        } catch {
            setSelectedCategorySlug(activeData.mountain_categories[0].slug);
        }
    }, [activeData, source]);

    // Save selected category slug
    const handleCategoryChange = (slug: string) => {
        setSelectedCategorySlug(slug);
        setSelectedIndex(0);
        setViewMode("list");
        setRevealedItems(new Set());
        try {
            localStorage.setItem(`memorize:last-cat:${source}`, slug);
        } catch {}
    };

    const stepCategory = useCallback(
        (dir: 1 | -1) => {
            if (!activeData || !activeData.mountain_categories.length) return;
            const idx = activeData.mountain_categories.findIndex(
                (c) => c.slug === selectedCategorySlug
            );
            const safeIdx = idx >= 0 ? idx : 0;
            const nextIdx =
                (safeIdx + dir + activeData.mountain_categories.length) %
                activeData.mountain_categories.length;
            handleCategoryChange(activeData.mountain_categories[nextIdx].slug);
        },
        [activeData, selectedCategorySlug]
    );

    const currentCategory = useMemo(() => {
        if (!activeData) return null;
        return (
            activeData.mountain_categories.find(
                (c) => c.slug === selectedCategorySlug
            ) || activeData.mountain_categories[0]
        );
    }, [activeData, selectedCategorySlug]);

    // Load local/server statuses for the current category. Server progress wins
    // when both copies exist; local-only progress is adopted into the account.
    useEffect(() => {
        if (!currentCategory) return;
        const remoteByKey = new Map(
            progress.map((item) => [
                progressKey(item.source, item.groupSlug, item.itemSlug),
                item,
            ])
        );
        const newStatuses: Record<string, ItemStatus> = {};
        const localProgressToSync: SyncedMemorizeProgress[] = [];
        const mergedProgress = [...progress];
        const mergedKeys = new Set(progress.map((item) =>
            progressKey(item.source, item.groupSlug, item.itemSlug)
        ));
        for (const item of currentCategory.mountain_contents) {
            const key = progressKey(source, currentCategory.slug, item.slug);
            const remote = remoteByKey.get(key);
            const local = getStoredStatus(source, currentCategory.slug, item.slug);
            if (user && remote) {
                newStatuses[item.slug] = remote.status;
                setStoredStatus(source, currentCategory.slug, item.slug, remote.status);
            } else {
                newStatuses[item.slug] = local ?? remote?.status ?? null;
                if (!local && remote) {
                    setStoredStatus(source, currentCategory.slug, item.slug, remote.status);
                }
                if (user && local && !remote && !syncedLocalKeys.current.has(key)) {
                    const record: SyncedMemorizeProgress = {
                        source,
                        groupSlug: currentCategory.slug,
                        itemSlug: item.slug,
                        status: local,
                    };
                    syncedLocalKeys.current.add(key);
                    localProgressToSync.push(record);
                    if (!mergedKeys.has(key)) {
                        mergedKeys.add(key);
                        mergedProgress.push(record);
                    }
                }
            }
        }
        setStatuses(newStatuses);
        if (localProgressToSync.length) {
            onProgress(mergedProgress);
            localProgressToSync.forEach((record) =>
                mutate("/api/me/memorize-progress", "PUT", record)
            );
        }
    }, [source, currentCategory, progress, user, mutate, onProgress]);

    // Prepare display items according to filter, shuffle & sort options
    const displayItems = useMemo(() => {
        if (!currentCategory) return [];
        let items = [...currentCategory.mountain_contents];

        // Apply Status Filter
        if (filterOption === "known") {
            items = items.filter((item) => statuses[item.slug] === "G");
        } else if (filterOption === "forgot") {
            items = items.filter((item) => statuses[item.slug] === "R");
        } else if (filterOption === "new") {
            items = items.filter((item) => !statuses[item.slug]);
        } else if (filterOption === "forgot-new") {
            items = items.filter((item) => statuses[item.slug] !== "G");
        }

        if (isShuffled) {
            items = items
                .map((item, idx) => ({
                    item,
                    sortKey: Math.sin(idx + shuffleSeed * 9999),
                }))
                .sort((a, b) => a.sortKey - b.sortKey)
                .map((d) => d.item);
        }

        if (sortOption === "alphabetical") {
            items.sort((a, b) => a.title.localeCompare(b.title));
        } else if (sortOption === "status") {
            const weight = (item: MountainItem) => {
                const s = statuses[item.slug];
                if (!s) return 0;
                if (s === "R") return 1;
                return 2;
            };
            items.sort((a, b) => weight(a) - weight(b));
        }

        return items;
    }, [currentCategory, filterOption, isShuffled, shuffleSeed, sortOption, statuses]);

    // Bound selected index safely
    useEffect(() => {
        if (selectedIndex >= displayItems.length && displayItems.length > 0) {
            setSelectedIndex(displayItems.length - 1);
        }
    }, [displayItems, selectedIndex]);

    const goNextItem = useCallback(() => {
        setSelectedIndex((prev) => Math.min(displayItems.length - 1, prev + 1));
    }, [displayItems.length]);

    const goPrevItem = useCallback(() => {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
    }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
    }, []);

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (touchStartX.current == null) return;
            const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
            const dx = endX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(dx) < 48) return;
            if (dx < 0) goNextItem();
            else goPrevItem();
        },
        [goNextItem, goPrevItem]
    );

    const currentItem = displayItems[selectedIndex] || null;

    // Scroll focused item into view in list mode
    useEffect(() => {
        if (viewMode === "list" && itemRefs.current[selectedIndex]) {
            itemRefs.current[selectedIndex]?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            });
        }
    }, [selectedIndex, viewMode]);

    // Update item status handler (G, R, W)
    const handleSetStatus = useCallback(
        (item: MountainItem, status: ItemStatus) => {
            if (!currentCategory) return;
            setStoredStatus(source, currentCategory.slug, item.slug, status);
            setStatuses((prev) => ({ ...prev, [item.slug]: status }));
            if (user) {
                const key = progressKey(source, currentCategory.slug, item.slug);
                const nextProgress = progress.filter(
                    (entry) =>
                        progressKey(entry.source, entry.groupSlug, entry.itemSlug) !==
                        key
                );
                const record = status
                    ? {
                          source,
                          groupSlug: currentCategory.slug,
                          itemSlug: item.slug,
                          status,
                      }
                    : null;
                if (record) nextProgress.push(record);
                onProgress(nextProgress);
                mutate("/api/me/memorize-progress", "PUT", {
                    source,
                    groupSlug: currentCategory.slug,
                    itemSlug: item.slug,
                    status,
                });
            }
        },
        [source, currentCategory, user, progress, mutate, onProgress]
    );

    // Audio / Speech output using backend audio proxy (with Origin: gregmat.com header)
    const handleSpeak = useCallback((item: MountainItem) => {
        if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current = null;
        }

        if (item.pronunciation) {
            const proxyUrl = `/api/audio-proxy?url=${encodeURIComponent(
                item.pronunciation
            )}`;
            const audio = new Audio(proxyUrl);
            currentAudioRef.current = audio;
            audio.play().catch(() => {
                // Speech synthesis fallback
                if ("speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance(item.title);
                    u.lang = "en-US";
                    window.speechSynthesis.speak(u);
                }
            });
        } else if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(item.title);
            u.lang = "en-US";
            window.speechSynthesis.speak(u);
        }
    }, []);

    // Toggle explicit definition reveal for current item
    const toggleRevealCurrentItem = useCallback(() => {
        if (!currentItem) return;
        setRevealedItems((prev) => {
            const next = new Set(prev);
            if (next.has(currentItem.slug)) {
                next.delete(currentItem.slug);
            } else {
                next.add(currentItem.slug);
            }
            return next;
        });
    }, [currentItem]);

    // Keyboard navigation & shortcuts handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (
                target?.matches("input, textarea, select, [contenteditable=true]")
            ) {
                return;
            }

            if (!displayItems.length) return;

            const key = e.key;
            const keyLower = key.toLowerCase();

            // Escape or Backspace in detail mode -> return to list page
            if ((key === "Escape" || key === "Backspace") && viewMode === "detail") {
                e.preventDefault();
                setViewMode("list");
                return;
            }

            // Arrow Down / Arrow Right / k -> Next item
            if (key === "ArrowDown" || key === "ArrowRight" || keyLower === "k") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(displayItems.length - 1, prev + 1));
                return;
            }

            // Arrow Up / Arrow Left / j -> Previous item
            if (key === "ArrowUp" || key === "ArrowLeft" || keyLower === "j") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(0, prev - 1));
                return;
            }

            // D -> Definition (toggle reveal or open detail page)
            if (keyLower === "d") {
                e.preventDefault();
                if (viewMode === "list") {
                    setViewMode("detail");
                }
                toggleRevealCurrentItem();
                return;
            }

            // G -> Mark Known
            if (keyLower === "g") {
                e.preventDefault();
                if (currentItem) {
                    handleSetStatus(currentItem, "G");
                }
                return;
            }

            // F -> Mark Forgot (shortcut updated from R to F)
            if (keyLower === "f") {
                e.preventDefault();
                if (currentItem) {
                    handleSetStatus(currentItem, "R");
                }
                return;
            }

            // W -> Reset status
            if (keyLower === "w") {
                e.preventDefault();
                if (currentItem) {
                    handleSetStatus(currentItem, null);
                }
                return;
            }

            // S -> Speak
            if (keyLower === "s") {
                e.preventDefault();
                if (currentItem) {
                    handleSpeak(currentItem);
                }
                return;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        displayItems,
        selectedIndex,
        currentItem,
        viewMode,
        toggleRevealCurrentItem,
        handleSetStatus,
        handleSpeak,
    ]);

    // Calculate group stats
    const stats = useMemo(() => {
        let gCount = 0;
        let rCount = 0;
        if (!currentCategory) return { gCount: 0, rCount: 0, unreviewed: 0, total: 0 };
        for (const item of currentCategory.mountain_contents) {
            const st = statuses[item.slug];
            if (st === "G") gCount++;
            else if (st === "R") rCount++;
        }
        const total = currentCategory.mountain_contents.length;
        return {
            gCount,
            rCount,
            unreviewed: total - gCount - rCount,
            total,
        };
    }, [currentCategory, statuses]);

    // Check definition visibility for detail view
    const isDefinitionVisibleInDetail = useMemo(() => {
        if (!currentItem) return false;
        return showDefinition || revealedItems.has(currentItem.slug);
    }, [currentItem, showDefinition, revealedItems]);

    return (
        <div className="memorize-container">
            {loading ? (
                <div className="memorize-loading">
                    <div className="spinner"></div>
                    <p>Loading Mountain Data...</p>
                </div>
            ) : error ? (
                <div className="memorize-error">
                    <p>{error}</p>
                    <button
                        className="memorize-btn primary"
                        onClick={() => {
                            setDataCache({});
                        }}
                    >
                        Retry
                    </button>
                </div>
            ) : !activeData || !currentCategory ? (
                <div className="memorize-empty">No category data found.</div>
            ) : viewMode === "detail" && currentItem ? (
                /* ==========================================================================
                   DEFINITION DETAIL PAGE VIEW (Instead of Popup Modal)
                   ========================================================================== */
                <div className="memorize-detail-page">
                    {/* Top Bar Navigation */}
                    <div className="detail-top-nav">
                        <button
                            className="back-list-btn"
                            onClick={() => setViewMode("list")}
                        >
                            <ArrowLeft size={18} />
                            <span>Back to List</span>
                        </button>

                        <div className="detail-position">
                            <span className="cat-title">{currentCategory.title}</span>
                            <span className="item-count">
                                {selectedIndex + 1} of {displayItems.length}
                            </span>
                        </div>

                        <div className="detail-nav-arrows">
                            <button
                                className="nav-arrow-btn"
                                disabled={selectedIndex <= 0}
                                onClick={() => setSelectedIndex((prev) => prev - 1)}
                                title="Previous item (← / ↑ / J)"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <button
                                className="nav-arrow-btn"
                                disabled={selectedIndex >= displayItems.length - 1}
                                onClick={() => setSelectedIndex((prev) => prev + 1)}
                                title="Next item (→ / ↓ / K)"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Main Detail Content Sheet */}
                    <div
                        className="detail-content-sheet"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="detail-header-row">
                            <div className="detail-title-group">
                                <h1>{currentItem.title}</h1>
                                {currentItem.tooltip && (
                                    <span className="detail-tooltip">
                                        ({currentItem.tooltip})
                                    </span>
                                )}
                            </div>

                            {currentItem.pronunciation || "speechSynthesis" in window ? (
                                <button
                                    className="detail-audio-btn"
                                    onClick={() => handleSpeak(currentItem)}
                                    title="Play pronunciation (S)"
                                >
                                    <Volume2 size={22} />
                                    <span>Speak</span>
                                </button>
                            ) : null}
                        </div>

                        {/* Status Action Buttons Bar */}
                        <div className="detail-status-bar">
                            <button
                                className={`detail-status-btn known ${
                                    statuses[currentItem.slug] === "G" ? "active" : ""
                                }`}
                                onClick={() => handleSetStatus(currentItem, "G")}
                            >
                                <Check size={18} />
                                <span>Known</span>
                            </button>
                            <button
                                className={`detail-status-btn forgot ${
                                    statuses[currentItem.slug] === "R" ? "active" : ""
                                }`}
                                onClick={() => handleSetStatus(currentItem, "R")}
                            >
                                <X size={18} />
                                <span>Forgot</span>
                            </button>
                            <button
                                className="detail-status-btn reset"
                                onClick={() => handleSetStatus(currentItem, null)}
                            >
                                <RotateCcw size={18} />
                                <span>Reset</span>
                            </button>
                        </div>

                        {/* Definition Body Section */}
                        <div className="detail-body-section">
                            {isDefinitionVisibleInDetail ? (
                                <div className="definition-box">
                                    <Html value={currentItem.description} />
                                </div>
                            ) : (
                                <div className="definition-hidden-box">
                                    <EyeOff size={36} />
                                    <p>Definition hidden</p>
                                    <button
                                        className="memorize-btn primary reveal-btn"
                                        onClick={toggleRevealCurrentItem}
                                    >
                                        Tap to Reveal Definition
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Mobile-friendly Prev / Next footer (thumb reach) */}
                        <div className="detail-bottom-nav">
                            <button
                                className="detail-bottom-btn"
                                disabled={selectedIndex <= 0}
                                onClick={goPrevItem}
                            >
                                <ChevronLeft size={20} />
                                <span>Prev</span>
                            </button>
                            <span className="detail-bottom-count">
                                {selectedIndex + 1} / {displayItems.length}
                            </span>
                            <button
                                className="detail-bottom-btn"
                                disabled={selectedIndex >= displayItems.length - 1}
                                onClick={goNextItem}
                            >
                                <span>Next</span>
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                /* ==========================================================================
                   SINGLE COLUMN LIST PAGE VIEW
                   ========================================================================== */
                <div className="memorize-content">
                    {/* Controls & Toolbar */}
                    <div className="memorize-toolbar">
                        {/* Group / Category Dropdown */}
                        <div className="memorize-group-picker">
                            <label htmlFor="group-select">Group:</label>
                            <div className="group-nav-row">
                                <button
                                    className="group-step-btn"
                                    onClick={() => stepCategory(-1)}
                                    title="Previous group"
                                    aria-label="Previous group"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="select-wrapper">
                                    <select
                                        id="group-select"
                                        value={currentCategory.slug}
                                        onChange={(e) => handleCategoryChange(e.target.value)}
                                    >
                                        {activeData.mountain_categories.map((cat, idx) => (
                                            <option key={cat.slug} value={cat.slug}>
                                                {cat.title || `Group ${idx + 1}`} ({cat.mountain_contents.length} items)
                                            </option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="select-icon" />
                                </div>
                                <button
                                    className="group-step-btn"
                                    onClick={() => stepCategory(1)}
                                    title="Next group"
                                    aria-label="Next group"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>

                        <button
                            type="button"
                            className={`mobile-filter-toggle memorize-mobile-filter-toggle ${
                                hasActiveFilters ? "has-active" : ""
                            }`}
                            onClick={() => setFiltersOpen((open) => !open)}
                            aria-expanded={filtersOpen}
                            aria-controls="memorize-actions"
                        >
                            <SlidersHorizontal size={18} />
                            Filters & order{hasActiveFilters ? " (active)" : ""}
                        </button>

                        {/* Actions Toolbar */}
                        <div
                            id="memorize-actions"
                            className={`memorize-actions ${
                                filtersOpen ? "is-open" : ""
                            }`}
                        >
                            {/* Filter Selector */}
                            <div className="memorize-sort-picker">
                                <Filter size={15} className="sort-icon" />
                                <select
                                    value={filterOption}
                                    onChange={(e) => {
                                        setFilterOption(e.target.value as FilterOption);
                                        setSelectedIndex(0);
                                    }}
                                >
                                    <option value="all">Show All</option>
                                    <option value="known">Known Only</option>
                                    <option value="forgot">Forgot Only</option>
                                    <option value="new">New Only</option>
                                    <option value="forgot-new">Forgot & New</option>
                                </select>
                            </div>

                            {/* Show Definition Toggle */}
                            <button
                                className={`memorize-toggle-btn ${
                                    showDefinition ? "active" : ""
                                }`}
                                onClick={() => setShowDefinition((prev) => !prev)}
                                title="Toggle automatically showing definition on detail page"
                            >
                                {showDefinition ? <Eye size={16} /> : <EyeOff size={16} />}
                                <span>Show Definition</span>
                            </button>

                            {/* Shuffle Button */}
                            <button
                                className={`memorize-btn ${isShuffled ? "active" : ""}`}
                                onClick={() => {
                                    setIsShuffled((prev) => !prev);
                                    setShuffleSeed((prev) => prev + 1);
                                    setSelectedIndex(0);
                                }}
                                title="Shuffle items order"
                            >
                                <Shuffle size={16} />
                                <span>{isShuffled ? "Shuffled" : "Shuffle"}</span>
                            </button>

                            {/* Sort Selector */}
                            <div className="memorize-sort-picker">
                                <SortAsc size={16} className="sort-icon" />
                                <select
                                    value={sortOption}
                                    onChange={(e) => {
                                        setSortOption(e.target.value as SortOption);
                                        setSelectedIndex(0);
                                    }}
                                >
                                    <option value="default">Default Order</option>
                                    <option value="alphabetical">Alphabetical (A-Z)</option>
                                    <option value="status">Status (Unreviewed first)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar & Stats */}
                    <div className="memorize-stats-bar">
                        <div className="stats-badges">
                            <span className="badge badge-g">
                                Known: <strong>{stats.gCount}</strong>
                            </span>
                            <span className="badge badge-r">
                                Forgot: <strong>{stats.rCount}</strong>
                            </span>
                            <span className="badge badge-u">
                                Remaining: <strong>{stats.unreviewed}</strong>
                            </span>
                            <span className="badge badge-total">
                                Total: <strong>{stats.total}</strong>
                            </span>
                        </div>
                        <div className="progress-track">
                            <div
                                className="progress-fill g-fill"
                                style={{
                                    width: `${(stats.gCount / stats.total) * 100}%`,
                                }}
                            />
                            <div
                                className="progress-fill r-fill"
                                style={{
                                    width: `${(stats.rCount / stats.total) * 100}%`,
                                }}
                            />
                        </div>
                    </div>

                    {/* Single Column Group Layout */}
                    {displayItems.length === 0 ? (
                        <div className="memorize-empty-filter">
                            <p>No items match the selected filter (<strong>{filterOption}</strong>).</p>
                            <button
                                className="memorize-btn primary"
                                onClick={() => {
                                    setFilterOption("all");
                                    setFiltersOpen(false);
                                }}
                            >
                                Reset Filter to Show All
                            </button>
                        </div>
                    ) : (
                        <div className="memorize-single-column">
                            {displayItems.map((item, index) => {
                                const status = statuses[item.slug];
                                const isFocused = index === selectedIndex;

                                return (
                                    <div
                                        key={item.slug}
                                        className={`memorize-item-card status-${
                                            status ? status.toLowerCase() : "none"
                                        } ${isFocused ? "focused" : ""}`}
                                        onClick={() => {
                                            setSelectedIndex(index);
                                            setViewMode("detail");
                                        }}
                                        ref={(el) => {
                                            itemRefs.current[index] = el;
                                        }}
                                        tabIndex={0}
                                        role="button"
                                    >
                                        <div className="item-main">
                                            <div className="item-left">
                                                <span className="item-index">{index + 1}.</span>
                                                <span className="item-title">{item.title}</span>
                                                {item.tooltip && (
                                                    <span className="item-tooltip">
                                                        ({item.tooltip})
                                                    </span>
                                                )}
                                            </div>

                                            <div className="item-right">
                                                {item.pronunciation && (
                                                    <button
                                                        className="audio-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSpeak(item);
                                                        }}
                                                        title="Listen to pronunciation"
                                                    >
                                                        <Volume2 size={16} />
                                                    </button>
                                                )}

                                                <div className="status-indicators">
                                                    <button
                                                        className={`status-btn g-btn ${
                                                            status === "G" ? "active" : ""
                                                        }`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSetStatus(
                                                                item,
                                                                status === "G" ? null : "G"
                                                            );
                                                        }}
                                                        title="Press G - Known"
                                                    >
                                                        G
                                                    </button>
                                                    <button
                                                        className={`status-btn r-btn ${
                                                            status === "R" ? "active" : ""
                                                        }`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSetStatus(
                                                                item,
                                                                status === "R" ? null : "R"
                                                            );
                                                        }}
                                                        title="Press F - Forgot"
                                                    >
                                                        F
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
