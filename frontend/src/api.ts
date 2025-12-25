import type { Playlist } from "./types";

export async function fetchPlaylist(): Promise<Playlist> {
  const r = await fetch("/playlist", { credentials: "include" });
  if (!r.ok) throw new Error("Failed to fetch playlist");
  return r.json();
}

export async function postProgress(file: string, resume_position: number, watched: boolean) {
  await fetch("/video-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ file, resume_position, watched })
  });
}