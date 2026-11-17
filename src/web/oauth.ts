// OAuth 2.0 authorization-code + PKCE client for the files server
// (files.tinnyterr.com). Endpoints per its /api/oauth/metadata:
//   authorize  <base>/oauth/authorize       (SPA consent page)
//   token      <base>/api/oauth/token       (form-encoded, client_secret_basic or public)
//   userinfo   <base>/api/oauth/userinfo    (needs the `profile` scope)
//   revoke     <base>/api/oauth/revoke
// We only want identity, so we ask for `profile` and revoke the grant once
// we've read the username — the site keeps its own session after that.

export interface OauthSettings {
  base: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface UserInfo {
  sub: string;
  username: string;
  role: string;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(s: OauthSettings, state: string, challenge: string): string {
  const url = new URL(`${s.base}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", s.clientId);
  url.searchParams.set("redirect_uri", s.redirectUri);
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function clientAuth(s: OauthSettings, body: URLSearchParams): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (s.clientSecret) {
    const basic = Buffer.from(
      `${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`,
    ).toString("base64");
    headers.authorization = `Basic ${basic}`;
  } else {
    body.set("client_id", s.clientId);
  }
  return headers;
}

export async function exchangeCode(
  s: OauthSettings,
  code: string,
  verifier: string,
): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: s.redirectUri,
    code_verifier: verifier,
  });
  const res = await fetch(`${s.base}/api/oauth/token`, {
    method: "POST",
    headers: clientAuth(s, body),
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(`token exchange failed: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  }
  return { access_token: json.access_token };
}

export async function fetchUserInfo(s: OauthSettings, accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${s.base}/api/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<UserInfo>;
  if (!res.ok || typeof json.username !== "string" || typeof json.sub !== "string") {
    throw new Error(`userinfo failed: ${res.status}`);
  }
  return { sub: json.sub, username: json.username, role: String(json.role ?? "") };
}

// Best effort: we don't need the token after reading the username.
export async function revokeToken(s: OauthSettings, token: string): Promise<void> {
  const body = new URLSearchParams({ token });
  await fetch(`${s.base}/api/oauth/revoke`, {
    method: "POST",
    headers: clientAuth(s, body),
    body,
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}
