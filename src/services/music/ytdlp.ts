import { config } from "../../config";
import type { RawTrack, Resolved } from "./track";

export function ytdlpArgs(): string[] {
  const args = ["--no-warnings", "--ignore-config"];
  if (config.music.ytdlpCookiesFile) args.push("--cookies", config.music.ytdlpCookiesFile);
  return args;
}

interface YtEntry {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  url?: string;
  webpage_url?: string;
  entries?: YtEntry[];
}

function entryToTrack(e: YtEntry): RawTrack | null {
  const url = e.webpage_url ?? e.url;
  if (!url || !/^https?:/.test(url)) return null;
  return { title: e.title ?? url, artist: e.uploader ?? e.channel, url, durationSec: e.duration };
}

// Single video, playlist or search. --flat-playlist keeps playlist imports
// fast (no per-video extraction until it's actually played).
export async function ytdlpResolve(input: string): Promise<Resolved> {
  const proc = Bun.spawn(
    [
      config.music.ytdlpPath,
      ...ytdlpArgs(),
      "--flat-playlist",
      "--playlist-end",
      String(config.music.maxPlaylistImport),
      "--dump-single-json",
      input,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`yt-dlp: ${err.trim().split("\n").pop() || `exit ${code}`}`);

  const json = JSON.parse(out) as YtEntry;
  if (json.entries) {
    const tracks = json.entries.map(entryToTrack).filter((t): t is RawTrack => t !== null);
    // A search returns a "playlist" of results; treat it as just the top hit.
    const isSearch = input.startsWith("ytsearch");
    return { collection: isSearch ? undefined : json.title, tracks: isSearch ? tracks.slice(0, 1) : tracks };
  }
  const t = entryToTrack({ ...json, url: json.webpage_url ?? input });
  return { tracks: t ? [t] : [] };
}
