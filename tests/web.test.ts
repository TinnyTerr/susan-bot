import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config";
import { formatLinkLine, listLinks, normaliseCatName, parseLinkLine } from "../src/catLinks";
import { createUpload, getUploaderStatus, reviewUpload, setUploaderStatus } from "../src/catUploads";
import { linkContent } from "../src/commands/cat";
import { authorizeUrl } from "../src/web/oauth";
import { escapeHtml } from "../src/web/pages";
import { extensionOf, looksLikeMedia, uploadName } from "../src/web/upload";

const mediaDir = mkdtempSync(join(tmpdir(), "cats-"));
(config.cats as { mediaDir: string }).mediaDir = mediaDir;
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

describe("cat links", () => {
  test("cat names are normalised and can't escape the media dir", () => {
    expect(normaliseCatName(" Susan ")).toBe("susan");
    expect(normaliseCatName("mr-whiskers_2")).toBe("mr-whiskers_2");
    expect(normaliseCatName("../etc")).toBeNull();
    expect(normaliseCatName("a/b")).toBeNull();
    expect(normaliseCatName("")).toBeNull();
    expect(normaliseCatName("x".repeat(33))).toBeNull();
  });

  test("bare-URL lines still parse; metadata round-trips", () => {
    expect(parseLinkLine("https://x/a.jpg")).toEqual({ url: "https://x/a.jpg" });
    const link = { url: "https://x/raw", name: "sleepy\tsusan", uploaderId: "123" };
    expect(parseLinkLine(formatLinkLine(link))).toEqual({ ...link, name: "sleepy susan" });
    expect(parseLinkLine("https://x\tname\tnot-an-id")).toEqual({ url: "https://x", name: "name" });
  });

  test("caption shows name and uploader, escaped", () => {
    expect(linkContent({ url: "u" })).toBe("u");
    expect(linkContent({ url: "u", name: "*bold*", uploaderId: "42" })).toBe("\\*bold\\* from <@42>\nu");
  });
});

describe("upload review", () => {
  const base = {
    cat: "susan",
    name: "nap",
    uploaderId: "111",
    uploaderName: "lewis",
    fileId: 1,
    url: "https://files.example/api/file/a/raw",
    contentType: "image/png",
  };

  test("trusted uploads go straight into links.txt", () => {
    createUpload({ ...base, status: "approved" });
    expect(listLinks("susan")).toEqual([{ url: base.url, name: "nap", uploaderId: "111" }]);
  });

  test("pending uploads are added once, on the first review only", () => {
    const row = createUpload({ ...base, cat: "nova", url: "https://f/b/raw", status: "pending" });
    expect(listLinks("nova")).toEqual([]);
    const approved = reviewUpload(row.id, "approved", "999", { name: "renamed", cat: "nova" });
    expect(approved?.name).toBe("renamed");
    expect(reviewUpload(row.id, "denied", "998")).toBeNull();
    expect(readFileSync(join(mediaDir, "nova", "links.txt"), "utf8")).toBe("https://f/b/raw\trenamed\t111\n");
  });

  test("denied uploads never reach links.txt", () => {
    const row = createUpload({ ...base, cat: "ghost", status: "pending" });
    expect(reviewUpload(row.id, "denied", "999")?.status).toBe("denied");
    expect(listLinks("ghost")).toEqual([]);
  });

  test("uploader allow/deny/reset", () => {
    expect(getUploaderStatus("222")).toBe("review");
    setUploaderStatus("222", "allowed", "1");
    expect(getUploaderStatus("222")).toBe("allowed");
    setUploaderStatus("222", "denied", "1");
    expect(getUploaderStatus("222")).toBe("denied");
    setUploaderStatus("222", "review", "1");
    expect(getUploaderStatus("222")).toBe("review");
  });
});

describe("web upload helpers", () => {
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
    expect(looksLikeMedia(".mp4", new TextEncoder().encode("\0\0\0\x18ftypisom"))).toBe(true);
  });

  test("upload name falls back to the filename", () => {
    expect(uploadName("  Box  time ", "IMG_001.jpg")).toBe("Box time");
    expect(uploadName("", "sleepy_susan-2.png")).toBe("sleepy susan 2");
    expect(uploadName("a\tb\nc", "x.png")).toBe("a b c");
  });

  test("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  test("Discord authorize URL", () => {
    const u = new URL(authorizeUrl({ clientId: "cid", clientSecret: "s", redirectUri: "https://cats.example/callback" }, "st"));
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("scope")).toBe("identify");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("redirect_uri")).toBe("https://cats.example/callback");
  });
});
