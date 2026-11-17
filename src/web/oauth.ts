// Discord OAuth2 (authorization code, confidential client, `identify` scope).
// We only need the user's id/name; the token is revoked straight after.
// The client is the bot's own application: CLIENT_ID + DISCORD_CLIENT_SECRET,
// with <WEB_PUBLIC_URL>/callback added under OAuth2 > Redirects in the portal.

const DISCORD = "https://discord.com";

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  displayName: string;
}

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export function authorizeUrl(s: OauthSettings, state: string): string {
  const url = new URL(`${DISCORD}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", s.clientId);
  url.searchParams.set("redirect_uri", s.redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  return url.toString();
}

function basicAuth(s: OauthSettings): string {
  return `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
}

export async function exchangeCode(s: OauthSettings, code: string): Promise<string> {
  const res = await fetch(`${DISCORD}/api/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(s) },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: s.redirectUri }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(`token exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  }
  return json.access_token;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD}/api/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.id !== "string" || typeof json.username !== "string") {
    throw new Error(`users/@me failed: ${res.status}`);
  }
  const displayName = typeof json.global_name === "string" && json.global_name ? json.global_name : json.username;
  return { id: json.id, username: json.username, displayName };
}

export async function revokeToken(s: OauthSettings, token: string): Promise<void> {
  await fetch(`${DISCORD}/api/oauth2/token/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth(s) },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}
