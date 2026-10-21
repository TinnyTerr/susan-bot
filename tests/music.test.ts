import { describe, expect, test } from "bun:test";
import { formatQueue } from "../src/commands/queue";
import { itunesToResolved, parseApple, playlistFromHtml } from "../src/services/music/apple";
import { entityToResolved, parseSpotify } from "../src/services/music/spotify";
import { searchTrack, trackSource } from "../src/services/music/track";

describe("link parsing", () => {
  test("spotify urls, intl urls and uris", () => {
    expect(parseSpotify("https://open.spotify.com/track/abc123?si=x")).toEqual({ kind: "track", id: "abc123" });
    expect(parseSpotify("https://open.spotify.com/intl-de/album/Z9")).toEqual({ kind: "album", id: "Z9" });
    expect(parseSpotify("spotify:playlist:P1")).toEqual({ kind: "playlist", id: "P1" });
    expect(parseSpotify("https://youtube.com/watch?v=1")).toBeNull();
    expect(parseSpotify("daft punk")).toBeNull();
  });
  test("apple album vs song-in-album vs playlist", () => {
    expect(parseApple("https://music.apple.com/us/album/discovery/697194953")).toEqual({ kind: "album", id: "697194953", storefront: "us" });
    expect(parseApple("https://music.apple.com/gb/album/one-more-time/697194953?i=697195787")).toEqual({
      kind: "song",
      id: "697195787",
      storefront: "gb",
    });
    expect(parseApple("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb")?.kind).toBe("playlist");
    expect(parseApple("https://music.apple.com/us/song/x/123")?.kind).toBe("song");
    expect(parseApple("https://example.com/us/album/x/1")).toBeNull();
  });
});

describe("resolution shapes", () => {
  test("search tracks build a ytsearch source", () => {
    expect(trackSource(searchTrack("Song", "Artist"))).toBe("ytsearch1:Artist - Song");
    expect(trackSource({ title: "t", url: "https://youtu.be/x" })).toBe("https://youtu.be/x");
  });
  test("spotify embed entities", () => {
    expect(entityToResolved("track", { name: "S", artists: [{ name: "A" }] }, 10).tracks[0]?.search).toBe("A - S");
    const r = entityToResolved("album", { name: "Alb", trackList: [{ title: "a", subtitle: "x" }, { title: "b" }] }, 1);
    expect(r.collection).toBe("Alb");
    expect(r.tracks).toHaveLength(1);
  });
  test("itunes album lookup skips the collection row", () => {
    const r = itunesToResolved(
      [
        { wrapperType: "collection", collectionName: "Discovery" },
        { wrapperType: "track", trackName: "One More Time", artistName: "Daft Punk", trackTimeMillis: 320000 },
      ],
      10,
    );
    expect(r.collection).toBe("Discovery");
    expect(r.tracks).toEqual([{ title: "One More Time", artist: "Daft Punk", search: "Daft Punk - One More Time", url: undefined, durationSec: 320 }]);
  });
  test("apple playlist json-ld", () => {
    const html = `<script name="schema:music-playlist" type="application/ld+json">{"name":"PL","track":[{"name":"T","byArtist":[{"name":"A"}]}]}</script>`;
    expect(playlistFromHtml(html, 10).tracks[0]?.search).toBe("A - T");
    expect(() => playlistFromHtml("<html></html>", 10)).toThrow();
  });
});

describe("formatQueue", () => {
  const t = (title: string) => ({ title, requestedBy: "u" });
  test("lists upcoming and loop mode", () => {
    const out = formatQueue(t("now"), [t("a"), t("b")], "queue", false);
    expect(out).toBe("Now playing: now\n1. a\n2. b\nLoop: queue");
  });
});
