import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Playlist, VideoItem } from "./types";
import { fetchPlaylist } from "./api";
import { Sidebar } from "./components/Sidebar";
import { VideoPane } from "./components/VideoPane";

function firstVideo(pl: Playlist): VideoItem | null {
  for (const c of pl.categories) for (const v of c.videos) if (v.watched!==true) return v;
  return null;
}

export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "watched" | "unwatched">("all");

  const [dark, setDark] = useState<boolean>(() => localStorage.getItem("theme") === "dark");

  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    (async () => {
      const pl = await fetchPlaylist();
      setPlaylist(pl);
      const initial = firstVideo(pl);
      setCurrentFile(initial?.file ?? null);

      // default all categories open
      const open: Record<string, boolean> = {};
      for (const c of pl.categories) if (initial && c.videos.includes(initial)) open[c.title] = true;
      setOpenCats(open);
    })().catch((e) => {
      console.error(e);
    });
  }, []);

  // Focus search with "/"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/") {
        e.preventDefault();
        // Sidebar search input is inside Sidebar, but simplest: focus first input on page
        const el = document.querySelector("input[placeholder='Search videos…']") as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = useMemo(() => {
    if (!playlist || !currentFile) return null;
    for (const c of playlist.categories) {
      for (const v of c.videos) if (v.file === currentFile) return v;
    }
    return null;
  }, [playlist, currentFile]);

  const toggleCat = (title: string) => setOpenCats((m) => ({ ...m, [title]: !(m[title] ?? true) }));

  const setCurrentByFile = (file: string) => setCurrentFile(file);

  const markLocalProgress = (file: string, resume: number, watched: boolean) => {
    setPlaylist((prev) => {
      if (!prev) return prev;
      const next: Playlist = {
        ...prev,
        categories: prev.categories.map((c) => ({
          ...c,
          videos: c.videos.map((v) => {
            if (v.file !== file) return v;
            return {
              ...v,
              resume_position: resume,
              watched: watched ? true : v.watched
            };
          })
        }))
      };
      return next;
    });
  };

  if (!playlist) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
        Loading…
      </div>
    );
  }

// App.tsx (replace the return layout wrapper)
    return (
    <div className="min-h-screen h-[100dvh] flex flex-col md:flex-row bg-slate-50 dark:bg-slate-900">
        {/* Video FIRST on mobile */}
        <div className="order-1 md:order-2 w-full flex-1 h-[50dvh] md:h-full min-h-0">
        <VideoPane
            playlist={playlist}
            current={current}
            setCurrentByFile={setCurrentByFile}
            markLocalProgress={markLocalProgress}
            dark={dark}
            toggleDark={() => setDark((d) => !d)}
        />
        </div>

        {/* Sidebar SECOND on mobile */}
        <div className={`order-2 md:order-1 ${sidebarCollapsed ? 'w-auto' : 'w-full md:w-[360px] md:max-w-[85vw]'} h-[50dvh] md:h-full shrink-0 min-h-0`}>
            <Sidebar
                playlist={playlist}
                openCats={openCats}
                toggleCat={toggleCat}
                currentFile={currentFile}
                onPick={(v) => setCurrentFile(v.file)}
                query={query}
                setQuery={setQuery}
                filter={filter}
                setFilter={setFilter}
                isCollapsed={sidebarCollapsed}
                toggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
        </div>
    </div>
    );
}