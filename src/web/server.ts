// Cat upload site. `bun run web`. Uploaders log in with Discord (identity
// only); files go to the files server under one storage account and are
// added to CAT_MEDIA_DIR/<cat>/links.txt with their name and uploader —
// immediately for allowed users, after review (Discord buttons / /cat review)
// for everyone else. Denied users can't log in.
import { REST, Routes } from "discord.js";
import { listCats, listLinks, listMedia } from "../commands/cat";
import { normaliseCatName } from "../catLinks";
import { getUploaderStatus } from "../catUploads";
import { config } from "../config";
import { logger } from "../logger";
import { authorizeUrl, exchangeCode, fetchDiscordUser, type OauthSettings, randomToken, revokeToken } from "./oauth";
import { loginPage, uploadPage } from "./pages";
import { saveUpload } from "./upload";

const log = logger.child({ module: "web" });
const web = config.web;

for (const [key, value] of [
  ["DISCORD_CLIENT_SECRET", web.discordClientSecret],
  ["CAT_FILES_API_KEY", web.filesApiKey],
] as const) {
  if (!value) {
    log.fatal(`${key} is not set`);
    process.exit(1);
  }
}
if (!web.reviewChannelId) log.warn("CAT_REVIEW_CHANNEL_ID not set — pending uploads only show in /cat review");
if (!config.guildId) log.warn("GUILD_ID not set — any Discord user can log in and queue uploads");

const oauth: OauthSettings = {
  clientId: config.clientId,
  clientSecret: web.discordClientSecret,
  redirectUri: `${web.publicUrl}/callback`,
};
const rest = new REST().setToken(config.discordToken);

const SECURE = web.publicUrl.startsWith("https://");
const PUBLIC_ORIGIN = new URL(web.publicUrl).origin;
const SESSION_COOKIE = "cat_session";
const PENDING_COOKIE = "cat_oauth";
const PENDING_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = web.sessionHours * 3600_000;
const UPLOAD_SLOTS = 5;

interface Session {
  userId: string;
  displayName: string;
  expires: number;
}

// In memory: a restart logs everyone out, which is fine for this.
const sessions = new Map<string, Session>();
const pending = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires <= now) sessions.delete(k);
  for (const [k, v] of pending) if (v <= now) pending.delete(k);
}, 60_000).unref();

function cookie(name: string, value: string, maxAgeSec: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
    ...(SECURE ? ["Secure"] : []),
  ].join("; ");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// Denial takes effect on the next request, not just the next login.
function currentSession(req: Request): Session | null {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s || s.expires <= Date.now() || getUploaderStatus(s.userId) === "denied") {
    sessions.delete(id);
    return null;
  }
  return s;
}

// SameSite=Lax already keeps the cookie off cross-site POSTs; this is the belt.
function sameOrigin(req: Request): boolean {
  return req.headers.get("origin") === PUBLIC_ORIGIN;
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function redirect(to: string, setCookie?: string[]): Response {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of setCookie ?? []) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

function renderUpload(s: Session, extra: Partial<Parameters<typeof uploadPage>[0]> = {}) {
  return html(
    uploadPage({
      username: s.displayName,
      trusted: getUploaderStatus(s.userId) === "allowed",
      cats: listCats().map((name) => ({ name, count: listMedia(name).length + listLinks(name).length })),
      defaultCat: config.cats.defaultName,
      maxMb: Math.floor(config.cats.maxUploadBytes / 1024 / 1024),
      slots: UPLOAD_SLOTS,
      ...extra,
    }),
  );
}

async function inGuild(userId: string): Promise<boolean> {
  if (!config.guildId) return true;
  try {
    await rest.get(Routes.guildMember(config.guildId, userId));
    return true;
  } catch {
    return false;
  }
}

function handleLogin(): Response {
  const state = randomToken();
  pending.set(state, Date.now() + PENDING_TTL_MS);
  // Bind the state to this browser too, so a callback link can't be replayed elsewhere.
  return redirect(authorizeUrl(oauth, state), [cookie(PENDING_COOKIE, state, PENDING_TTL_MS / 1000)]);
}

async function handleCallback(req: Request, url: URL): Promise<Response> {
  const clearPending = cookie(PENDING_COOKIE, "", 0);
  const fail = (msg: string, status = 400) => html(loginPage(msg), status, { "set-cookie": clearPending });

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "Login was cancelled." : `Login failed: ${error}`);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const expires = pending.get(state);
  pending.delete(state);
  if (!state || !code || !expires || expires <= Date.now() || readCookie(req, PENDING_COOKIE) !== state) {
    return fail("Login expired or didn't start here. Try again.");
  }

  let user: Awaited<ReturnType<typeof fetchDiscordUser>>;
  try {
    const token = await exchangeCode(oauth, code);
    user = await fetchDiscordUser(token);
    void revokeToken(oauth, token);
  } catch (err) {
    log.warn({ err }, "Discord OAuth callback failed");
    return fail("Couldn't complete login with Discord.", 502);
  }

  if (getUploaderStatus(user.id) === "denied") return fail("You're not allowed to upload here.", 403);
  if (!(await inGuild(user.id))) return fail("You need to be in the server to upload.", 403);

  const sid = randomToken();
  sessions.set(sid, { userId: user.id, displayName: user.displayName, expires: Date.now() + SESSION_TTL_MS });
  log.info({ userId: user.id, username: user.username }, "Logged in");
  return redirect("/", [clearPending, cookie(SESSION_COOKIE, sid, SESSION_TTL_MS / 1000)]);
}

async function handleUpload(req: Request, s: Session): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return renderUpload(s, { error: "Couldn't read the upload." });

  const cat = normaliseCatName(String(form.get("cat") ?? ""));
  if (!cat) return renderUpload(s, { error: "Cat name must be letters, numbers, - or _ (max 32)." });

  const entries: { file: File; name: string }[] = [];
  for (let i = 0; i < UPLOAD_SLOTS; i++) {
    const file = form.get(`file${i}`);
    if (file && typeof file !== "string" && file.name !== "") {
      entries.push({ file: file as unknown as File, name: String(form.get(`name${i}`) ?? "") });
    }
  }
  if (!entries.length) return renderUpload(s, { error: "Pick at least one file." });

  const trusted = getUploaderStatus(s.userId) === "allowed";
  const added: { name: string; pending: boolean }[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const { file, name } of entries) {
    const r = await saveUpload(cat, file, name, { id: s.userId, displayName: s.displayName, trusted });
    if (r.ok) added.push({ name: r.upload.name, pending: r.upload.status === "pending" });
    else failed.push({ name: r.name, reason: r.reason });
  }
  log.info({ userId: s.userId, cat, added: added.length, skipped: failed.length, trusted }, "Cat upload");
  return renderUpload(s, { results: { added, failed, cat } });
}

const server = Bun.serve({
  port: web.port,
  hostname: web.host,
  maxRequestBodySize: config.cats.maxUploadBytes * UPLOAD_SLOTS + 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (url.pathname === "/") {
        const s = currentSession(req);
        return s ? renderUpload(s) : html(loginPage());
      }
      if (url.pathname === "/login") return handleLogin();
      if (url.pathname === "/callback") return handleCallback(req, url);
      if (url.pathname === "/health") return new Response("ok");
    }

    if (req.method === "POST" && (url.pathname === "/upload" || url.pathname === "/logout")) {
      if (!sameOrigin(req)) return new Response("bad origin", { status: 403 });
      if (url.pathname === "/logout") {
        const sid = readCookie(req, SESSION_COOKIE);
        if (sid) sessions.delete(sid);
        return redirect("/", [cookie(SESSION_COOKIE, "", 0)]);
      }
      const s = currentSession(req);
      if (!s) return redirect("/");
      return handleUpload(req, s);
    }

    return new Response("not found", { status: 404 });
  },
  error(err) {
    log.error({ err }, "Unhandled web error");
    return new Response("internal error", { status: 500 });
  },
});

log.info({ url: web.publicUrl, listen: `${server.hostname}:${server.port}` }, "Cat upload site up");
