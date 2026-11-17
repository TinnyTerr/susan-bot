// Cat upload site. `bun run web`. Logs in via OAuth against the files server
// (identity only, `profile` scope), then lets allowed users drop photos/videos
// straight into CAT_MEDIA_DIR/<cat>/ — the same folders /cat reads from.
import { listCats, listLinks, listMedia } from "../commands/cat";
import { config } from "../config";
import { logger } from "../logger";
import {
  authorizeUrl,
  exchangeCode,
  fetchUserInfo,
  type OauthSettings,
  pkceChallenge,
  randomToken,
  revokeToken,
} from "./oauth";
import { loginPage, uploadPage } from "./pages";
import { normaliseCatName, saveUpload } from "./upload";

const log = logger.child({ module: "web" });
const web = config.web;

if (!web.oauthClientId) {
  log.fatal("WEB_OAUTH_CLIENT_ID is not set — register an OAuth app on the files server first");
  process.exit(1);
}

const oauth: OauthSettings = {
  base: web.oauthBase,
  clientId: web.oauthClientId,
  clientSecret: web.oauthClientSecret,
  redirectUri: `${web.publicUrl}/callback`,
};

const SECURE = web.publicUrl.startsWith("https://");
const PUBLIC_ORIGIN = new URL(web.publicUrl).origin;
const SESSION_COOKIE = "cat_session";
const PENDING_COOKIE = "cat_oauth";
const PENDING_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = web.sessionHours * 3600_000;
const MAX_FILES_PER_UPLOAD = 20;

// In memory: a restart logs everyone out, which is fine for this.
const sessions = new Map<string, { username: string; expires: number }>();
const pending = new Map<string, { verifier: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires <= now) sessions.delete(k);
  for (const [k, v] of pending) if (v.expires <= now) pending.delete(k);
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

function currentUser(req: Request): string | null {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s || s.expires <= Date.now()) return null;
  return s.username;
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
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
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

function catSummary() {
  return listCats().map((name) => ({
    name,
    count: listMedia(name).length + listLinks(name).length,
  }));
}

function renderUpload(username: string, extra: Partial<Parameters<typeof uploadPage>[0]> = {}) {
  return html(
    uploadPage({
      username,
      cats: catSummary(),
      defaultCat: config.cats.defaultName,
      maxMb: Math.floor(config.cats.maxUploadBytes / 1024 / 1024),
      ...extra,
    }),
  );
}

async function handleLogin(): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken(48);
  pending.set(state, { verifier, expires: Date.now() + PENDING_TTL_MS });
  // Bind the state to this browser too, so a callback link can't be replayed elsewhere.
  return redirect(authorizeUrl(oauth, state, await pkceChallenge(verifier)), [
    cookie(PENDING_COOKIE, state, PENDING_TTL_MS / 1000),
  ]);
}

async function handleCallback(req: Request, url: URL): Promise<Response> {
  const clearPending = cookie(PENDING_COOKIE, "", 0);
  const fail = (msg: string, status = 400) =>
    html(loginPage(msg), status, { "set-cookie": clearPending });

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "Login was cancelled." : `Login failed: ${error}`);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const entry = pending.get(state);
  pending.delete(state);
  if (!state || !code || !entry || entry.expires <= Date.now() || readCookie(req, PENDING_COOKIE) !== state) {
    return fail("Login expired or didn't start here. Try again.");
  }

  let username: string;
  try {
    const { access_token } = await exchangeCode(oauth, code, entry.verifier);
    username = (await fetchUserInfo(oauth, access_token)).username;
    void revokeToken(oauth, access_token);
  } catch (err) {
    log.warn({ err }, "OAuth callback failed");
    return fail("Couldn't complete login with the files server.", 502);
  }

  if (web.allowedUsers.length && !web.allowedUsers.includes(username.toLowerCase())) {
    log.info({ username }, "Rejected login from user not in WEB_ALLOWED_USERS");
    return fail(`${username} isn't allowed to upload here.`, 403);
  }

  const sid = randomToken();
  sessions.set(sid, { username, expires: Date.now() + SESSION_TTL_MS });
  log.info({ username }, "Logged in");
  return redirect("/", [clearPending, cookie(SESSION_COOKIE, sid, SESSION_TTL_MS / 1000)]);
}

async function handleUpload(req: Request, username: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return renderUpload(username, { error: "Couldn't read the upload." });
  const cat = normaliseCatName(String(form.get("cat") ?? ""));
  if (!cat) return renderUpload(username, { error: "Cat name must be letters, numbers, - or _ (max 32)." });

  const files = form
    .getAll("files")
    .filter((f) => typeof f !== "string" && f.name !== "") as unknown as File[];
  if (!files.length) return renderUpload(username, { error: "Pick at least one file." });
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return renderUpload(username, { error: `At most ${MAX_FILES_PER_UPLOAD} files at once.` });
  }

  const ok: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const file of files) {
    const r = await saveUpload(cat, file, username);
    if (r.ok) ok.push(r.file);
    else failed.push({ name: r.name, reason: r.reason });
  }
  log.info({ username, cat, added: ok.length, skipped: failed.length }, "Cat upload");
  return renderUpload(username, { results: { ok, failed, cat } });
}

const server = Bun.serve({
  port: web.port,
  hostname: web.host,
  maxRequestBodySize: config.cats.maxUploadBytes * MAX_FILES_PER_UPLOAD + 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url);
    const user = currentUser(req);

    if (req.method === "GET" && url.pathname === "/") {
      return user ? renderUpload(user) : html(loginPage());
    }
    if (req.method === "GET" && url.pathname === "/login") return handleLogin();
    if (req.method === "GET" && url.pathname === "/callback") return handleCallback(req, url);
    if (req.method === "GET" && url.pathname === "/health") return new Response("ok");

    if (req.method === "POST" && (url.pathname === "/upload" || url.pathname === "/logout")) {
      if (!sameOrigin(req)) return new Response("bad origin", { status: 403 });
      if (url.pathname === "/logout") {
        const sid = readCookie(req, SESSION_COOKIE);
        if (sid) sessions.delete(sid);
        return redirect("/", [cookie(SESSION_COOKIE, "", 0)]);
      }
      if (!user) return redirect("/");
      return handleUpload(req, user);
    }

    return new Response("not found", { status: 404 });
  },
  error(err) {
    log.error({ err }, "Unhandled web error");
    return new Response("internal error", { status: 500 });
  },
});

log.info({ url: web.publicUrl, listen: `${server.hostname}:${server.port}` }, "Cat upload site up");
