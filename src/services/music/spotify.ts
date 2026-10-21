import { config } from "../../config";
import { fetchJson } from "../media";
import { searchTrack, type RawTrack, type Resolved } from "./track";

export type SpotifyKind = "track" | "album" | "playlist";

export function parseSpotify(input: string): { kind: SpotifyKind; id: string } | null {
  const uri = input.match(/^spotify:(track|album|playlist):([A-Za-z0-9]+)$/);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2]! };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname !== "open.spotify.com") return null;
  const m = url.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  return m ? { kind: m[1] as SpotifyKind, id: m[2]! } : null;
}

let cached: { token: string; expires: number } | null = null;

async function appToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 30_000) return cached.token;
  const basic = btoa(`${config.music.spotifyClientId}:${config.music.spotifyClientSecret}`);
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

interface ApiTrack {
  name: string;
  artists: { name: string }[];
  duration_ms: number;
}

const apiTrack = (t: ApiTrack) => searchTrack(t.name, t.artists[0]?.name, Math.round(t.duration_ms / 1000));

async function viaApi(kind: SpotifyKind, id: string): Promise<Resolved> {
  const headers = { Authorization: `Bearer ${await appToken()}` };
  const get = <T>(path: string) => fetchJson<T>(`https://api.spotify.com/v1${path}`, { headers });
  const cap = config.music.maxPlaylistImport;

  if (kind === "track") return { tracks: [apiTrack(await get<ApiTrack>(`/tracks/${id}`))] };

  const tracks: RawTrack[] = [];
  if (kind === "album") {
    const album = await get<{ name: string }>(`/albums/${id}`);
    for (let offset = 0; tracks.length < cap; offset += 50) {
      const page = await get<{ items: ApiTrack[]; next: string | null }>(`/albums/${id}/tracks?limit=50&offset=${offset}`);
      tracks.push(...page.items.map(apiTrack));
      if (!page.next) break;
    }
    return { collection: album.name, tracks: tracks.slice(0, cap) };
  }

  const pl = await get<{ name: string }>(`/playlists/${id}?fields=name`);
  for (let offset = 0; tracks.length < cap; offset += 100) {
    const page = await get<{ items: { track: ApiTrack | null }[]; next: string | null }>(
      `/playlists/${id}/tracks?limit=100&offset=${offset}`,
    );
    tracks.push(...page.items.flatMap((i) => (i.track ? [apiTrack(i.track)] : [])));
    if (!page.next) break;
  }
  return { collection: pl.name, tracks: tracks.slice(0, cap) };
}

// No creds: the public embed page ships its data as __NEXT_DATA__. Undocumented
// and liable to change, so everything is read defensively.
interface EmbedEntity {
  name?: string;
  title?: string;
  subtitle?: string;
  artists?: { name: string }[];
  duration?: number;
  trackList?: { title?: string; subtitle?: string; duration?: number }[];
}

export function entityToResolved(kind: SpotifyKind, e: EmbedEntity, cap: number): Resolved {
  if (kind === "track") {
    const artist = e.artists?.[0]?.name ?? e.subtitle;
    const title = e.name ?? e.title;
    return { tracks: title ? [searchTrack(title, artist, e.duration ? Math.round(e.duration / 1000) : undefined)] : [] };
  }
  const tracks = (e.trackList ?? [])
    .filter((t) => t.title)
    .slice(0, cap)
    .map((t) => searchTrack(t.title!, t.subtitle, t.duration ? Math.round(t.duration / 1000) : undefined));
  return { collection: e.name ?? e.title, tracks };
}

async function viaEmbed(kind: SpotifyKind, id: string): Promise<Resolved> {
  const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spotify embed responded ${res.status}`);
  const html = await res.text();
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1];
  if (!raw) throw new Error("couldn't read Spotify page (set SPOTIFY_CLIENT_ID/SECRET)");
  const data = JSON.parse(raw);
  const entity = data?.props?.pageProps?.state?.data?.entity as EmbedEntity | undefined;
  if (!entity) throw new Error("couldn't read Spotify page (set SPOTIFY_CLIENT_ID/SECRET)");
  return entityToResolved(kind, entity, config.music.maxPlaylistImport);
}

export async function resolveSpotify(kind: SpotifyKind, id: string): Promise<Resolved> {
  if (config.music.spotifyClientId && config.music.spotifyClientSecret) return viaApi(kind, id);
  return viaEmbed(kind, id);
}
