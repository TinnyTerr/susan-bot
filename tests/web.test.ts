import { describe, expect, test } from "bun:test";
import { authorizeUrl, pkceChallenge } from "../src/web/oauth";
import { escapeHtml } from "../src/web/pages";
import { extensionOf, looksLikeMedia, normaliseCatName } from "../src/web/upload";

describe("web upload helpers", () => {
  test("cat names are normalised and can't escape the media dir", () => {
    expect(normaliseCatName(" Susan ")).toBe("susan");
    expect(normaliseCatName("mr-whiskers_2")).toBe("mr-whiskers_2");
    expect(normaliseCatName("../etc")).toBeNull();
    expect(normaliseCatName("a/b")).toBeNull();
    expect(normaliseCatName("")).toBeNull();
    expect(normaliseCatName("x".repeat(33))).toBeNull();
  });

  test("extensions are whitelisted", () => {
    expect(extensionOf("cat.JPEG")).toBe(".jpg");
    expect(extensionOf("cat.webm")).toBe(".webm");
    expect(extensionOf("cat.exe")).toBeNull();
    expect(extensionOf("cat")).toBeNull();
  });

  test("magic bytes must match the extension", () => {
    expect(looksLikeMedia(".jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeMedia(".png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(looksLikeMedia(".png", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    const mp4 = new TextEncoder().encode("\0\0\0\x18ftypisom");
    expect(looksLikeMedia(".mp4", mp4)).toBe(true);
  });

  test("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
});

describe("web oauth", () => {
  test("PKCE S256 matches the RFC 7636 example", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("authorize URL carries code flow + PKCE params", () => {
    const u = new URL(
      authorizeUrl(
        { base: "https://files.example", clientId: "cid", clientSecret: "", redirectUri: "https://cats.example/callback" },
        "st",
        "ch",
      ),
    );
    expect(u.origin + u.pathname).toBe("https://files.example/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://cats.example/callback",
      scope: "profile",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});
