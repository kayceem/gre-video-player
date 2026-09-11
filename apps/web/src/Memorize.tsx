import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Eye,
    EyeOff,
    HelpCircle,
    RotateCcw,
    Shuffle,
    SortAsc,
    Volume2,
    X,
} from "lucide-react";
import type {
    ItemStatus,
    MountainCategory,
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

export function Memorize() {
    const [source, setSource] = useState<MountainSource>(() => {
        try {
            return (
                (localStorage.getItem("memorize:last-source") as MountainSource) ||
                "verbal"
            );
        } catch {
            return "verbal";
        }
    });

    const [dataCache, setDataCache] = useState<
        Partial<Record<MountainSource, MountainData>>
    >({});
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const [selectedCategorySlug, setSelectedCategorySlug] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(0);

    // Controls & Toggles
    const [showDefinition, setShowDefinition] = useState<boolean>(() => {
        try {
            return localStorage.getItem("memorize:show-def") === "true";
        } catch {
            return false;
        }
    });
    const [sortOption, setSortOption] = useState<SortOption>("default");
    const [isShuffled, setIsShuffled] = useState<boolean>(false);
    const [shuffleSeed, setShuffleSeed] = useState<number>(0);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    // Explicitly revealed items in current session (when D is pressed inside modal or main)
    const [revealedItems, setRevealedItems] = useState<Set<string>>(new Set());

    // Status mapping state (itemSlug -> status) to trigger quick re-renders
    const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});

    const currentAudioRef = useRef<HTMLAudioElement | null>(null);
    const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

    // Save source preference
    useEffect(() => {
        try {
            localStorage.setItem("memorize:last-source", source);
        } catch {}
    }, [source]);

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
        setRevealedItems(new Set());
        try {
            localStorage.setItem(`memorize:last-cat:${source}`, slug);
        } catch {}
    };

    const currentCategory = useMemo(() => {
        if (!activeData) return null;
        return (
            activeData.mountain_categories.find(
                (c) => c.slug === selectedCategorySlug
            ) || activeData.mountain_categories[0]
        );
    }, [activeData, selectedCategorySlug]);

    // Load statuses for current category
    useEffect(() => {
        if (!currentCategory) return;
        const newStatuses: Record<string, ItemStatus> = {};
        for (const item of currentCategory.mountain_contents) {
            newStatuses[item.slug] = getStoredStatus(
                source,
                currentCategory.slug,
                item.slug
            );
        }
        setStatuses(newStatuses);
        setSelectedIndex(0);
    }, [source, currentCategory]);

    // Prepare display items according to shuffle & sort options
    const displayItems = useMemo(() => {
        if (!currentCategory) return [];
        let items = [...currentCategory.mountain_contents];

        if (isShuffled) {
            // Seeded deterministic pseudo-shuffle for stable rendering during state updates
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
            // Unreviewed first, then R (forgot), then G (knew)
            const weight = (item: MountainItem) => {
                const s = statuses[item.slug];
                if (!s) return 0;
                if (s === "R") return 1;
                return 2;
            };
            items.sort((a, b) => weight(a) - weight(b));
        }

        return items;
    }, [currentCategory, isShuffled, shuffleSeed, sortOption, statuses]);

    // Bound selected index safely
    useEffect(() => {
        if (selectedIndex >= displayItems.length && displayItems.length > 0) {
            setSelectedIndex(displayItems.length - 1);
        }
    }, [displayItems, selectedIndex]);

    const currentItem = displayItems[selectedIndex] || null;

    // Scroll focused item into view in list
    useEffect(() => {
        if (!isModalOpen && itemRefs.current[selectedIndex]) {
            itemRefs.current[selectedIndex]?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            });
        }
    }, [selectedIndex, isModalOpen]);

    // Update item status handler (G, R, W)
    const handleSetStatus = useCallback(
        (item: MountainItem, status: ItemStatus) => {
            if (!currentCategory) return;
            setStoredStatus(source, currentCategory.slug, item.slug, status);
            setStatuses((prev) => ({ ...prev, [item.slug]: status }));
        },
        [source, currentCategory]
    );

    // Audio / Speech output
    const handleSpeak = useCallback((item: MountainItem) => {
        if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current = null;
        }

        if (item.pronunciation) {
            const audio = new Audio(item.pronunciation);
            currentAudioRef.current = audio;
            audio.play().catch(() => {
                // Speech synthesis fallback if audio playback fails
                if ("speechSynthesis" in window) {
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

            // Modal Escape
            if (key === "Escape" && isModalOpen) {
                e.preventDefault();
                setIsModalOpen(false);
                return;
            }

            // Arrow Down / k -> Next item
            if (key === "ArrowDown" || keyLower === "k") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(displayItems.length - 1, prev + 1));
                return;
            }

            // Arrow Up / j -> Previous item
            if (key === "ArrowUp" || keyLower === "j") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(0, prev - 1));
                return;
            }

            // D -> Definition
            if (keyLower === "d") {
                e.preventDefault();
                if (!isModalOpen) {
                    setIsModalOpen(true);
                }
                toggleRevealCurrentItem();
                return;
            }

            // G -> Knew this
            if (keyLower === "g") {
                e.preventDefault();
                if (currentItem) {
                    handleSetStatus(currentItem, "G");
                }
                return;
            }

            // R -> Forgot this
            if (keyLower === "r") {
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
        isModalOpen,
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

    // Check definition visibility for current modal item
    const isDefinitionVisibleInModal = useMemo(() => {
        if (!currentItem) return false;
        return showDefinition || revealedItems.has(currentItem.slug);
    }, [currentItem, showDefinition, revealedItems]);

    return (
        <div className="memorize-container">
            {/* Page Header */}
            <header className="memorize-header">
                <div className="memorize-title-section">
                    <h1>GRE Mountain Memorize</h1>
                    <p>
                        Master GRE Vocabulary and Quant concepts with spaced repetition
                        shortcuts.
                    </p>
                </div>

                {/* Source Selection Tabs */}
                <div className="memorize-source-tabs">
                    {SOURCE_CONFIGS.map((cfg) => (
                        <button
                            key={cfg.id}
                            className={`memorize-tab-btn ${
                                source === cfg.id ? "active" : ""
                            }`}
                            onClick={() => {
                                setSource(cfg.id);
                                setIsModalOpen(false);
                            }}
                        >
                            <span>{cfg.label}</span>
                        </button>
                    ))}
                </div>
            </header>

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
            ) : (
                <div className="memorize-content">
                    {/* Controls & Toolbar */}
                    <div className="memorize-toolbar">
                        {/* Group / Category Dropdown */}
                        <div className="memorize-group-picker">
                            <label htmlFor="group-select">Group:</label>
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
                        </div>

                        {/* Actions Toolbar */}
                        <div className="memorize-actions">
                            {/* Show Definition Toggle */}
                            <button
                                className={`memorize-toggle-btn ${
                                    showDefinition ? "active" : ""
                                }`}
                                onClick={() => setShowDefinition((prev) => !prev)}
                                title="Toggle automatically showing definition in modal/list"
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
                                Knew: <strong>{stats.gCount}</strong>
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
                                        setIsModalOpen(true);
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
                                                    title="Press G - I knew this"
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
                                                    title="Press R - I forgot this"
                                                >
                                                    R
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Keyboard Shortcuts Hint Bar */}
                    <div className="memorize-shortcuts-bar">
                        <div className="shortcut-tag">
                            <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>J</kbd> <kbd>K</kbd> Navigate
                        </div>
                        <div className="shortcut-tag">
                            <kbd>D</kbd> Definition Modal
                        </div>
                        <div className="shortcut-tag">
                            <kbd>G</kbd> I Knew This
                        </div>
                        <div className="shortcut-tag">
                            <kbd>R</kbd> I Forgot This
                        </div>
                        <div className="shortcut-tag">
                            <kbd>W</kbd> Reset
                        </div>
                        <div className="shortcut-tag">
                            <kbd>S</kbd> Speak
                        </div>
                    </div>
                </div>
            )}

            {/* Definition Modal */}
            {isModalOpen && currentItem && (
                <div
                    className="memorize-modal-backdrop"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="memorize-modal-card"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="modal-header">
                            <div className="modal-title-row">
                                <span className="modal-num">
                                    {selectedIndex + 1} / {displayItems.length}
                                </span>
                                <h2>{currentItem.title}</h2>
                                {currentItem.pronunciation || "speechSynthesis" in window ? (
                                    <button
                                        className="modal-audio-btn"
                                        onClick={() => handleSpeak(currentItem)}
                                        title="Play audio (S)"
                                    >
                                        <Volume2 size={20} />
                                    </button>
                                ) : null}
                            </div>
                            <button
                                className="modal-close-btn"
                                onClick={() => setIsModalOpen(false)}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body / Definition */}
                        <div className="modal-body">
                            {isDefinitionVisibleInModal ? (
                                <div className="definition-box">
                                    {currentItem.tooltip && (
                                        <p className="definition-tooltip">
                                            <em>{currentItem.tooltip}</em>
                                        </p>
                                    )}
                                    <Html value={currentItem.description} />
                                </div>
                            ) : (
                                <div className="definition-hidden-box">
                                    <EyeOff size={32} />
                                    <p>Definition hidden</p>
                                    <button
                                        className="memorize-btn primary"
                                        onClick={toggleRevealCurrentItem}
                                    >
                                        Press <strong>D</strong> or Click to Reveal Definition
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer Controls */}
                        <div className="modal-footer">
                            <div className="modal-actions-left">
                                <button
                                    className={`modal-action-btn g-action ${
                                        statuses[currentItem.slug] === "G" ? "active" : ""
                                    }`}
                                    onClick={() => handleSetStatus(currentItem, "G")}
                                >
                                    <Check size={16} />
                                    <span>known</span>
                                </button>
                                <button
                                    className={`modal-action-btn r-action ${
                                        statuses[currentItem.slug] === "R" ? "active" : ""
                                    }`}
                                    onClick={() => handleSetStatus(currentItem, "R")}
                                >
                                    <X size={16} />
                                    <span>Forgot</span>
                                </button>
                                <button
                                    className="modal-action-btn w-action"
                                    onClick={() => handleSetStatus(currentItem, null)}
                                    title="Reset status"
                                >
                                    <RotateCcw size={16} />
                                    <span>Reset</span>
                                </button>
                            </div>

                            <div className="modal-nav-right">
                                <button
                                    className="modal-nav-btn"
                                    disabled={selectedIndex <= 0}
                                    onClick={() => setSelectedIndex((prev) => prev - 1)}
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <button
                                    className="modal-nav-btn"
                                    disabled={selectedIndex >= displayItems.length - 1}
                                    onClick={() => setSelectedIndex((prev) => prev + 1)}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
