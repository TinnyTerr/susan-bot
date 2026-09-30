import { describe, expect, test } from "bun:test";
import { buildMediaEmbed } from "../src/mediaView";
import { toResult as anilist } from "../src/services/anilist";
import { toResult as deezer } from "../src/services/deezer";
import { formatDuration, stripHtml, truncate } from "../src/services/media";
import { toResult as tmdb } from "../src/services/tmdb";

describe("helpers", () => {
  test("stripHtml turns br into newlines and drops tags", () => {
    expect(stripHtml("a<br>b <i>c</i>")).toBe("a\nb c");
  });
  test("truncate adds an ellipsis only when cutting", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
  });
  test("formatDuration pads seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
  });
});

describe("services", () => {
  test("anilist prefers english title and lists romaji as subtitle", () => {
    const r = anilist({
      title: { romaji: "Sousou no Frieren", english: "Frieren" },
      description: "An elf<br>walks.",
      averageScore: 91,
      episodes: 28,
      chapters: null,
      format: "TV",
      status: "FINISHED",
      seasonYear: 2023,
      startDate: { year: 2023 },
      genres: ["Fantasy"],
      siteUrl: "https://anilist.co/anime/1",
      coverImage: { large: "https://img" },
    });
    expect(r.title).toBe("Frieren");
    expect(r.subtitle).toBe("Sousou no Frieren · 2023");
    expect(r.fields.find((f) => f.name === "Episodes")?.value).toBe("28");
    expect(r.description).toBe("An elf\nwalks.");
  });

  test("tmdb builds a type-specific url and skips empty ratings", () => {
    const r = tmdb(
      { id: 7, name: "Show", overview: "", first_air_date: "2020-01-02", vote_average: 0, vote_count: 0, poster_path: null },
      "tv",
    );
    expect(r.url).toBe("https://www.themoviedb.org/tv/7");
    expect(r.fields.map((f) => f.name)).toEqual(["First aired"]);
    expect(r.imageUrl).toBeUndefined();
  });

  test("deezer track shows album and length", () => {
    const r = deezer(
      { title: "Song", link: "https://deezer/t", duration: 200, artist: { name: "Band" }, album: { title: "LP", cover_big: "c" } },
      "track",
    );
    expect(r.subtitle).toBe("Band");
    expect(r.fields).toEqual([{ name: "Album", value: "LP" }, { name: "Length", value: "3:20" }]);
    expect(r.imageUrl).toBe("c");
  });
});

describe("buildMediaEmbed", () => {
  test("puts the rest under Also", () => {
    const mk = (title: string) => ({ title, url: `https://x/${title}`, fields: [] });
    const embed = buildMediaEmbed([mk("a"), mk("b"), mk("c")]);
    expect(embed.data.title).toBe("a");
    expect(embed.data.fields?.[0]?.value).toContain("[b](https://x/b)");
  });
});
