import { parseApple, resolveApple } from "./apple";
import { parseSpotify, resolveSpotify } from "./spotify";
import type { Resolved } from "./track";
import { ytdlpResolve } from "./ytdlp";

// Anything the user types into /play. Spotify and Apple links are resolved to
// metadata and later searched on YouTube; everything else (YouTube, SoundCloud,
// Bandcamp, any URL yt-dlp understands, or plain text) goes straight to yt-dlp.
export async function resolveInput(input: string): Promise<Resolved> {
  const text = input.trim();

  const spotify = parseSpotify(text);
  if (spotify) return resolveSpotify(spotify.kind, spotify.id);

  const apple = parseApple(text);
  if (apple) return resolveApple(apple);

  return ytdlpResolve(/^https?:\/\//i.test(text) ? text : `ytsearch1:${text}`);
}
