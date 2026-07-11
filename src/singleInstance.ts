import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// Resolves the absolute path of the entry script a given pid was launched
// with (e.g. ".../src/index.ts"), by reading /proc directly. Returns null if
// /proc isn't available (non-Linux) or the process/cmdline can't be read.
function resolveEntryFor(pid: number): string | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "latin1");
    const parts = raw.split("\0").filter(Boolean);
    const script = parts.find((p) => p.endsWith(".ts") || p.endsWith(".js"));
    if (!script) return null;
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    return path.resolve(cwd, script);
  } catch {
    return null;
  }
}

// Finds any other process running this same entry script (a leftover from a
// prior restart that never fully exited) and kills it, so only one bot
// process is ever connected to the Discord gateway at a time. No-ops safely
// if /proc isn't available.
export function killStaleInstances(signal: NodeJS.Signals = "SIGTERM") {
  const selfEntry = resolveEntryFor(process.pid);
  if (!selfEntry) return;

  let pids: number[];
  try {
    pids = readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    return;
  }

  for (const pid of pids) {
    if (pid === process.pid) continue;
    const entry = resolveEntryFor(pid);
    if (entry !== selfEntry) continue;

    logger.warn({ pid, entry }, "Killing stale duplicate bot process");
    try {
      process.kill(pid, signal);
    } catch (err) {
      logger.error({ pid, err }, "Failed to kill stale bot process");
    }
  }
}
