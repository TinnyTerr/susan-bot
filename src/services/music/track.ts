// One queued thing. Spotify/Apple tracks have no audio of their own, so they
// carry a `search` query that yt-dlp resolves to a YouTube result at play time;
// YouTube/SoundCloud/etc. carry a direct `url`.
export interface Track {
  title: string;
  artist?: string;
  url?: string;
  search?: string;
  durationSec?: number;
  requestedBy: string;
}

export type RawTrack = Omit<Track, "requestedBy">;

export interface Resolved {
  // Name of the album/playlist when the input was a collection.
  collection?: string;
  tracks: RawTrack[];
}

export function searchTrack(title: string, artist: string | undefined, durationSec?: number): RawTrack {
  return { title, artist, search: artist ? `${artist} - ${title}` : title, durationSec };
}

export function trackSource(t: RawTrack): string {
  return t.url ?? `ytsearch1:${t.search ?? t.title}`;
}

export function trackLabel(t: RawTrack): string {
  return t.artist ? `${t.artist} - ${t.title}` : t.title;
}
