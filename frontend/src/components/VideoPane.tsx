import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Playlist, VideoItem } from "../types";
import { postProgress } from "../api";
import { videoUrl } from "../utils";

type Props = {
  playlist: Playlist;
  current: VideoItem | null;
  setCurrentByFile: (file: string) => void;
  markLocalProgress: (file: string, resume: number, watched: boolean) => void;
  dark: boolean;
  toggleDark: () => void;
};

export function VideoPane(props: Props) {
  const { playlist, current, setCurrentByFile, markLocalProgress, dark, toggleDark } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [duration, setDuration] = useState<number>(0);
  const [lastSavedAt, setLastSavedAt] = useState<number>(0);

  const flat = useMemo(() => {
    const out: VideoItem[] = [];
    for (const c of playlist.categories) for (const v of c.videos) out.push(v);
    return out;
  }, [playlist]);

  const idx = current ? flat.findIndex((v) => v.file === current.file) : -1;
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;

  // Resume when metadata loaded
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current) return;

    const onLoaded = () => {
      const d = Number.isFinite(el.duration) ? el.duration : 0;
      setDuration(d);
      const resume = Math.max(0, current.resume_position || 0);
      if (resume > 1 && d > 0 && resume < d - 0.5) {
        try { el.currentTime = resume; } catch {}
      }
      // Autoplay after loading
      el.play().catch(() => {});
    };

    el.addEventListener("loadedmetadata", onLoaded);
    return () => el.removeEventListener("loadedmetadata", onLoaded);
  }, [current?.file]);

  // Autosave every ~5s while playing
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !current) return;

    const interval = window.setInterval(async () => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;
      const now = Date.now();
      if (now - lastSavedAt < 4500) return;

      const pos = videoRef.current.currentTime || 0;
      const d = videoRef.current.duration || duration || 0;
      const watched = d > 0 ? (pos / d) >= 0.95 : false;

      markLocalProgress(current.file, pos, watched || current.watched);
      setLastSavedAt(now);
      try { await postProgress(current.file, pos, watched || current.watched); } catch {}
    }, 1000);

    return () => window.clearInterval(interval);
  }, [current?.file, current?.watched, duration, lastSavedAt, markLocalProgress]);

  // Save on unload (best-effort)
  useEffect(() => {
    const handler = () => {
      const el = videoRef.current;
      if (!el || !current) return;
      const pos = el.currentTime || 0;
      const d = el.duration || duration || 0;
      const watched = d > 0 ? (pos / d) >= 0.95 : false;

      const payload = JSON.stringify({ file: current.file, resume_position: pos, watched: watched || current.watched });
      navigator.sendBeacon?.("/video-progress", new Blob([payload], { type: "application/json" }));
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [current, duration]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n" && next) setCurrentByFile(next.file);
      if (e.key === "p" && prev) setCurrentByFile(prev.file);
      if (e.key === "d") toggleDark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, setCurrentByFile, toggleDark]);

  const onTimeUpdate = async () => {
    const el = videoRef.current;
    if (!el || !current) return;
    const pos = el.currentTime || 0;
    const d = el.duration || duration || 0;

    // If crosses watched threshold, mark watched + persist once.
    if (!current.watched && d > 0 && pos / d >= 0.95) {
      markLocalProgress(current.file, pos, true);
      try { await postProgress(current.file, pos, true); } catch {}
    }
  };

  const onEnded = async () => {
    if (!current) return;
    markLocalProgress(current.file, (videoRef.current?.currentTime || 0), true);
    try { await postProgress(current.file, (videoRef.current?.currentTime || 0), true); } catch {}
    if (next) setCurrentByFile(next.file);
  };

  const handleMarkAsWatched = async () => {
    if (!current) return;
    const pos = videoRef.current?.currentTime || 0;
    markLocalProgress(current.file, pos, true);
    try { await postProgress(current.file, pos, true); } catch {}
  };

  // Simple swipe left/right on mobile to next/prev
  const touch = useRef<{ x: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { touch.current = { x: e.clientX, t: Date.now() }; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!touch.current) return;
    const dx = e.clientX - touch.current.x;
    const dt = Date.now() - touch.current.t;
    touch.current = null;
    if (dt < 600 && Math.abs(dx) > 80) {
      if (dx < 0 && next) setCurrentByFile(next.file);
      if (dx > 0 && prev) setCurrentByFile(prev.file);
    }
  };

  if (!current) {
    return (
      <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900">
        <TopBar dark={dark} toggleDark={toggleDark} />
        <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-300">
          Pick a video from the playlist.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <TopBar dark={dark} toggleDark={toggleDark} />

      <div className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-500 dark:text-slate-400">Now playing</div>
          <div className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{current.title}</div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            disabled={!prev}
            onClick={() => prev && setCurrentByFile(prev.file)}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:text-slate-300 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={handleMarkAsWatched}
            disabled={current.watched}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-50 bg-blue-50 dark:text-slate-300 dark:bg-blue-900/20"
            title={current.watched ? "Already marked as watched" : "Mark this video as watched"}
          >
            {current.watched ? "✓ Watched" : "Mark Watched"}
          </button>
          <button
            disabled={!next}
            onClick={() => next && setCurrentByFile(next.file)}
            className="px-3 py-2 rounded-lg border border-slate-300 dark:text-slate-300 dark:border-slate-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      <div className="px-0 md:px-4 pb-0 md:pb-4 flex-1 min-h-0">
        <div className="h-full rounded-none md:rounded-xl overflow-hidden bg-black shadow">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            controls
            src={videoUrl(current.file)}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            playsInline
          />
        </div>
      </div>
    </div>
  );
}

function TopBar({ dark, toggleDark }: { dark: boolean; toggleDark: () => void }) {
  return (
    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur flex items-center justify-between">
      <div className="text-sm text-slate-600 dark:text-slate-300">
        Swipe on the video
      </div>
      <button
        onClick={toggleDark}
        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:text-slate-300 text-sm"
        title="Toggle dark mode (or press 'd')"
      >
        {dark ? "Light" : "Dark"}
      </button>
    </div>
  );
}