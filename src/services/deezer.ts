import { fetchJson, formatDuration, type MediaResult } from "./media";

export type DeezerType = "track" | "album" | "artist";

interface DeezerItem {
  title?: string;
  name?: string;
  link: string;
  duration?: number;
  nb_tracks?: number;
  nb_album?: number;
  nb_fan?: number;
  record_type?: string;
  artist?: { name: string };
  album?: { title: string; cover_big?: string };
  cover_big?: string;
  picture_big?: string;
}

export function toResult(item: DeezerItem, type: DeezerType): MediaResult {
  const fields: MediaResult["fields"] = [];
  if (type === "track") {
    if (item.album) fields.push({ name: "Album", value: item.album.title });
    if (item.duration) fields.push({ name: "Length", value: formatDuration(item.duration) });
  } else if (type === "album") {
    if (item.nb_tracks) fields.push({ name: "Tracks", value: String(item.nb_tracks) });
    if (item.record_type) fields.push({ name: "Type", value: item.record_type });
  } else {
    if (item.nb_album) fields.push({ name: "Albums", value: String(item.nb_album) });
    if (item.nb_fan) fields.push({ name: "Fans", value: item.nb_fan.toLocaleString("en-US") });
  }
  return {
    title: item.title ?? item.name ?? "Unknown",
    subtitle: type === "artist" ? undefined : item.artist?.name,
    url: item.link,
    imageUrl: item.cover_big ?? item.picture_big ?? item.album?.cover_big,
    fields,
  };
}

export async function searchDeezer(query: string, type: DeezerType): Promise<MediaResult[]> {
  const data = await fetchJson<{ data: DeezerItem[] }>(
    `https://api.deezer.com/search/${type}?${new URLSearchParams({ q: query, limit: "5" })}`,
  );
  return data.data.map((r) => toResult(r, type));
}
