import { fetchJson, stripHtml, titleCase, truncate, type MediaResult } from "./media";

export type AniListType = "ANIME" | "MANGA";

interface AniListMedia {
  title: { romaji: string | null; english: string | null };
  description: string | null;
  averageScore: number | null;
  episodes: number | null;
  chapters: number | null;
  format: string | null;
  status: string | null;
  seasonYear: number | null;
  startDate: { year: number | null };
  genres: string[];
  siteUrl: string;
  coverImage: { large: string | null };
}

const QUERY = `
query ($q: String, $type: MediaType) {
  Page(perPage: 5) {
    media(search: $q, type: $type, sort: SEARCH_MATCH) {
      title { romaji english }
      description(asHtml: false)
      averageScore episodes chapters format status seasonYear
      startDate { year }
      genres siteUrl
      coverImage { large }
    }
  }
}`;

export function toResult(m: AniListMedia): MediaResult {
  const fields: MediaResult["fields"] = [];
  if (m.format) fields.push({ name: "Format", value: titleCase(m.format) });
  if (m.status) fields.push({ name: "Status", value: titleCase(m.status) });
  const count = m.episodes ?? m.chapters;
  if (count) fields.push({ name: m.episodes ? "Episodes" : "Chapters", value: String(count) });
  if (m.averageScore) fields.push({ name: "Score", value: `${m.averageScore}/100` });
  if (m.genres.length) fields.push({ name: "Genres", value: m.genres.slice(0, 5).join(", ") });

  const year = m.seasonYear ?? m.startDate.year;
  return {
    title: m.title.english ?? m.title.romaji ?? "Unknown",
    subtitle: [m.title.english && m.title.romaji !== m.title.english ? m.title.romaji : null, year]
      .filter(Boolean)
      .join(" · ") || undefined,
    url: m.siteUrl,
    description: m.description ? truncate(stripHtml(m.description), 500) : undefined,
    imageUrl: m.coverImage.large ?? undefined,
    fields,
  };
}

export async function searchAniList(query: string, type: AniListType): Promise<MediaResult[]> {
  const data = await fetchJson<{ data: { Page: { media: AniListMedia[] } } }>("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { q: query, type } }),
  });
  return data.data.Page.media.map(toResult);
}
