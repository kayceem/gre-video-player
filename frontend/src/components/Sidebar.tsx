import React from "react";
import type { Playlist, VideoItem } from "../types";
import { formatTime } from "../utils";

type Props = {
  playlist: Playlist;
  openCats: Record<string, boolean>;
  toggleCat: (title: string) => void;
  currentFile: string | null;
  onPick: (v: VideoItem) => void;
  query: string;
  setQuery: (s: string) => void;
  filter: "all" | "watched" | "unwatched";
  setFilter: (f: "all" | "watched" | "unwatched") => void;
};

export function Sidebar(props: Props) {
  const { playlist, openCats, toggleCat, currentFile, onPick, query, setQuery, filter, setFilter } = props;

  const q = query.trim().toLowerCase();

  return (
    // Sidebar.tsx (outermost div className)
    <div className="h-full min-h-0 flex flex-col border-t md:border-t-0 md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="p-4 space-y-3">
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{playlist.title}</div>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search videos…"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="unwatched">Unwatched</option>
            <option value="watched">Watched</option>
          </select>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">
          Tip: press <span className="font-mono">n</span>/<span className="font-mono">p</span> for next/prev, <span className="font-mono">/</span> to focus search.
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-4">
        {playlist.categories.map((cat) => {
          const isOpen = openCats[cat.title] ?? false;

          const visibleVideos = cat.videos.filter((v) => {
            if (filter === "watched" && !v.watched) return false;
            if (filter === "unwatched" && v.watched) return false;
            if (q && !v.title.toLowerCase().includes(q)) return false;
            return true;
          });

          if (visibleVideos.length === 0) return null;

          return (
            <div key={cat.title} className="mb-2">
              <button
                onClick={() => toggleCat(cat.title)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 text-left"
              >
                <span className="font-semibold text-xl text-slate-800 dark:text-slate-200">{cat.title}</span>
                <span className="text-slate-500 dark:text-slate-400">{isOpen ? "▾" : "▸"}</span>
              </button>

              {isOpen && (
                <div className="mt-1 space-y-1">
                  {visibleVideos.map((v) => {
                    const active = v.file === currentFile;
                    return (
                      <button
                        key={v.file}
                        onClick={() => onPick(v)}
                        className={[
                          "w-full px-3 py-2 rounded-lg text-left flex items-center gap-2",
                          active ? "bg-slate-200 dark:bg-slate-800" : "hover:bg-slate-100 dark:hover:bg-slate-900"
                        ].join(" ")}
                        title={v.updated_at ? `Last saved: ${v.updated_at}` : undefined}
                      >
                        <span className={["text-xs w-4", v.watched ? "text-emerald-600" : "text-slate-400"].join(" ")}>
                          {v.watched ? "✓" : "•"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={["truncate text-sm", v.watched ? "text-slate-500 line-through" : "text-slate-900 dark:text-slate-100"].join(" ")}>
                            {v.title}
                          </div>
                          {!v.watched && v.resume_position > 1 && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Resume at {formatTime(v.resume_position)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}