export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

const STYLE = `
  :root { color-scheme: light dark; --fg:#222; --bg:#faf7f2; --muted:#777; --accent:#b4632d; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --bg:#1b1a19; --muted:#999; --card:#262422; } }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; }
  main { max-width: 560px; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  p.muted, .muted { color: var(--muted); }
  .card { background: var(--card); border-radius: 10px; padding: 1.25rem; box-shadow: 0 1px 3px #0002; }
  label { display: block; font-weight: 600; margin: 1rem 0 .3rem; }
  input[type=text], input[type=file] { width: 100%; padding: .5rem; font: inherit; }
  button, .button { background: var(--accent); color: #fff; border: 0; border-radius: 6px;
    padding: .55rem 1.1rem; font: inherit; cursor: pointer; text-decoration: none; display: inline-block; }
  button.link { background: none; color: var(--muted); padding: 0; text-decoration: underline; }
  header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5rem; }
  ul { padding-left: 1.2rem; }
  .row { display: grid; gap: .3rem; margin-bottom: .8rem; }
  .ok { color: #3a8d3a; } .err { color: #c0392b; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

export function loginPage(error?: string): string {
  return layout(
    "Cat uploads",
    `<h1>Cat uploads</h1>
<p class="muted">Add photos and videos to the pool <code>/cat</code> draws from.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<p><a class="button" href="/login">Log in with Discord</a></p>`,
  );
}

export interface UploadPageOpts {
  username: string;
  trusted: boolean;
  cats: { name: string; count: number }[];
  defaultCat: string;
  results?: {
    added: { name: string; pending: boolean }[];
    failed: { name: string; reason: string }[];
    cat: string;
  };
  error?: string;
  maxMb: number;
  slots: number;
}

export function uploadPage(o: UploadPageOpts): string {
  const options = o.cats.map((c) => `<option value="${escapeHtml(c.name)}">`).join("");
  const counts = o.cats.length
    ? o.cats.map((c) => `<li>${escapeHtml(c.name)} <span class="muted">(${c.count})</span></li>`).join("")
    : `<li class="muted">No cats yet.</li>`;

  let results = "";
  if (o.results) {
    const { added, failed, cat } = o.results;
    const live = added.filter((a) => !a.pending);
    const queued = added.filter((a) => a.pending);
    const names = (xs: { name: string }[]) => xs.map((x) => escapeHtml(x.name)).join(", ");
    results = `<div class="card" style="margin-bottom:1rem">
${live.length ? `<p class="ok">Added to ${escapeHtml(cat)}: ${names(live)}</p>` : ""}
${queued.length ? `<p>Waiting for review (${escapeHtml(cat)}): ${names(queued)}</p>` : ""}
${failed.length ? `<p class="err">Skipped:</p><ul>${failed.map((f) => `<li>${escapeHtml(f.name)}: ${escapeHtml(f.reason)}</li>`).join("")}</ul>` : ""}
</div>`;
  }

  const rows = Array.from(
    { length: o.slots },
    (_, i) => `<div class="row">
    <input name="file${i}" type="file" ${i === 0 ? "required" : ""}
      accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.webm,image/*,video/*">
    <input name="name${i}" type="text" maxlength="80" placeholder="Name (optional, defaults to the filename)">
  </div>`,
  ).join("");

  return layout(
    "Cat uploads",
    `<header><h1>Cat uploads</h1>
<form method="post" action="/logout"><span class="muted">${escapeHtml(o.username)}</span>
<button class="link" type="submit">log out</button></form></header>
${o.error ? `<p class="err">${escapeHtml(o.error)}</p>` : ""}
${results}
<form class="card" method="post" action="/upload" enctype="multipart/form-data">
  <label for="cat">Cat</label>
  <input id="cat" name="cat" type="text" list="cats" required value="${escapeHtml(o.defaultCat)}"
    pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,31}" title="letters, numbers, - and _ (new name makes a new cat)">
  <datalist id="cats">${options}</datalist>
  <label>Photos / videos</label>
  ${rows}
  <p class="muted">jpg, png, gif, webp, mp4, mov, webm. Up to ${o.maxMb} MB each.
  ${o.trusted ? "Your uploads go straight in." : "Uploads are added once an admin approves them."}</p>
  <button type="submit">Upload</button>
</form>
<h2 style="font-size:1.1rem;margin-top:2rem">Cats</h2>
<ul>${counts}</ul>`,
  );
}
