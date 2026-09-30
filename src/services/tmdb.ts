import { fetchJson, truncate, type MediaResult } from "./media";

export type TmdbType = "movie" | "tv";

interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
}

export function toResult(item: TmdbItem, type: TmdbType): MediaResult {
  const title = item.title ?? item.name ?? "Unknown";
  const original = item.original_title ?? item.original_name;
  const date = item.release_date || item.first_air_date;
  const fields: MediaResult["fields"] = [];
  if (date) fields.push({ name: type === "movie" ? "Released" : "First aired", value: date });
  if (item.vote_count > 0) {
    fields.push({ name: "Rating", value: `${item.vote_average.toFixed(1)}/10 (${item.vote_count} votes)` });
  }
  return {
    title,
    subtitle: [original && original !== title ? original : null, date?.slice(0, 4)].filter(Boolean).join(" · ") || undefined,
    url: `https://www.themoviedb.org/${type}/${item.id}`,
    description: item.overview ? truncate(item.overview, 500) : undefined,
    imageUrl: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : undefined,
    fields,
  };
}

export async function searchTmdb(query: string, type: TmdbType, apiKey: string): Promise<MediaResult[]> {
  const params = new URLSearchParams({ query, api_key: apiKey, include_adult: "false" });
  const data = await fetchJson<{ results: TmdbItem[] }>(`https://api.themoviedb.org/3/search/${type}?${params}`);
  return data.results.slice(0, 5).map((r) => toResult(r, type));
}
