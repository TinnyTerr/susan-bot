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
