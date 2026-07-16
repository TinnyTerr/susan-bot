import { spawnSync } from "bun";

export interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(args: string[]): GitCommandResult {
  const proc = spawnSync({ cmd: ["git", ...args], stdout: "pipe", stderr: "pipe" });
  return {
    ok: proc.success,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}

export function getCurrentBranch(): string | null {
  const res = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  return res.ok ? res.stdout : null;
}

export function getCurrentCommit(): string | null {
  const res = run(["rev-parse", "HEAD"]);
  return res.ok ? res.stdout : null;
}

export function fetchRemote(): GitCommandResult {
  return run(["fetch", "--quiet"]);
}

export function getRemoteCommit(branch: string): string | null {
  const res = run(["rev-parse", `origin/${branch}`]);
  return res.ok ? res.stdout : null;
}

// Commits reachable from toRef but not fromRef, newest first, one line each.
export function getCommitLog(fromRef: string, toRef: string, maxLines = 10): string[] {
  const res = run(["log", "--oneline", `${fromRef}..${toRef}`]);
  if (!res.ok || !res.stdout) return [];
  return res.stdout.split("\n").slice(0, maxLines);
}

export function hasLocalChanges(): boolean {
  const res = run(["status", "--porcelain"]);
  return res.ok && res.stdout.length > 0;
}

export function pull(branch: string): GitCommandResult {
  return run(["pull", "--ff-only", "origin", branch]);
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

// Unit separator — won't appear in commit metadata, so it's safe to split on.
const FIELD_SEP = "\x1f";
const LOG_FORMAT = ["%H", "%h", "%an", "%ad", "%s"].join(FIELD_SEP);

function parseLogEntries(stdout: string): CommitEntry[] {
  if (!stdout) return [];
  return stdout.split("\n").map((line) => {
    const [hash, shortHash, author, date, subject] = line.split(FIELD_SEP);
    return {
      hash: hash ?? "",
      shortHash: shortHash ?? "",
      author: author ?? "",
      date: date ?? "",
      subject: subject ?? "",
    };
  });
}

export interface LogQuery {
  grep?: string;
  skip?: number;
  limit?: number;
}

// Paginated commit history on HEAD, optionally filtered by a case-insensitive
// commit-message search term. Args are passed as separate argv entries (not
// through a shell), so grep content can't inject additional git flags.
export function queryLog({ grep, skip = 0, limit = 10 }: LogQuery): CommitEntry[] {
  const args = ["log", `--format=${LOG_FORMAT}`, "--date=short", `--skip=${skip}`, "-n", `${limit}`];
  if (grep) args.push(`--grep=${grep}`, "--regexp-ignore-case");
  args.push("HEAD");
  const res = run(args);
  return res.ok ? parseLogEntries(res.stdout) : [];
}

export function countCommits(grep?: string): number {
  const args = ["rev-list", "--count"];
  if (grep) args.push(`--grep=${grep}`, "--regexp-ignore-case");
  args.push("HEAD");
  const res = run(args);
  const n = Number.parseInt(res.stdout, 10);
  return res.ok && Number.isFinite(n) ? n : 0;
}

// Alphanumeric plus common ref characters; deliberately excludes a leading
// "-" so the value can never be interpreted as a git flag.
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-./^~]{0,99}$/;

// Full recursive list of tracked file paths at a ref, for rendering a
// directory tree. Verifies the ref resolves to a real tree before passing it
// to ls-tree, since it comes straight from user input.
export function getFileTree(ref: string): string[] | null {
  if (!REF_PATTERN.test(ref)) return null;
  const verify = run(["rev-parse", "--verify", "--quiet", `${ref}^{tree}`]);
  if (!verify.ok) return null;
  const res = run(["ls-tree", "-r", "--name-only", ref]);
  if (!res.ok) return null;
  return res.stdout ? res.stdout.split("\n").filter(Boolean) : [];
}

const HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/;

export interface CommitDetail extends CommitEntry {
  body: string;
  stat: string;
}

// Looks up a single commit by full or abbreviated hash. Rejects anything that
// isn't hex before touching git, since the hash comes straight from user
// input and would otherwise be passed through as an arbitrary revision.
export function showCommit(hash: string): { ok: true; commit: CommitDetail } | { ok: false; error: string } {
  if (!HASH_PATTERN.test(hash)) {
    return { ok: false, error: "That doesn't look like a commit hash." };
  }

  const infoRes = run(["show", "-s", `--format=${LOG_FORMAT}${FIELD_SEP}%b`, "--date=short", hash]);
  if (!infoRes.ok || !infoRes.stdout) {
    return { ok: false, error: "No commit found with that hash." };
  }
  const [fullHash, shortHash, author, date, subject, ...bodyParts] = infoRes.stdout.split(FIELD_SEP);

  const statRes = run(["show", "--stat", "--format=", hash]);

  return {
    ok: true,
    commit: {
      hash: fullHash ?? hash,
      shortHash: shortHash ?? hash.slice(0, 7),
      author: author ?? "",
      date: date ?? "",
      subject: subject ?? "",
      body: bodyParts.join(FIELD_SEP).trim(),
      stat: statRes.ok ? statRes.stdout.trim() : "",
    },
  };
}
