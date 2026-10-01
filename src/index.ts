import path from "node:path";
import type { Subprocess } from "bun";
import { config } from "./config";
import { logger } from "./logger";
import { killStaleInstances } from "./singleInstance";

// Shard manager: a long-lived supervisor that spawns each shard (src/bot.ts,
// which holds the actual Discord client) as its own child process and keeps
// it alive. This process never respawns itself, so `bun run start`/`dev` and
// any process manager watching it see one continuously-running process —
// only the child shard gets replaced on /git update or a crash, instead of
// the old approach of the whole bot process detaching a replacement and
// exiting, which could orphan a process once the parent shell/session went
// away.
killStaleInstances();

const ext = import.meta.path.endsWith(".ts") ? "ts" : "js";
const BOT_ENTRY = path.join(import.meta.dir, `bot.${ext}`);
const SHARD_COUNT = config.sharding.count;
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_IN_WINDOW = 5;
const CRASH_RESPAWN_DELAY_MS = 2000;
const RESTART_RESPAWN_DELAY_MS = 500;

interface ShardState {
  id: number;
  proc: Subprocess | null;
  restarting: boolean;
  crashTimestamps: number[];
}

const shards = new Map<number, ShardState>();

function spawnShard(id: number) {
  logger.info({ shard: id }, "Spawning shard");

  const proc = Bun.spawn({
    cmd: [process.execPath, BOT_ENTRY],
    cwd: process.cwd(),
    env: { ...process.env, SHARD_ID: String(id), SHARD_COUNT: String(SHARD_COUNT) },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    ipc(message) {
      handleShardMessage(id, message);
    },
    onExit(_subprocess, exitCode, signalCode) {
      handleShardExit(id, exitCode, signalCode);
    },
  });

  const state = shards.get(id);
  if (state) {
    state.proc = proc;
    state.restarting = false;
  } else {
    shards.set(id, { id, proc, restarting: false, crashTimestamps: [] });
  }
}

function handleShardMessage(id: number, message: unknown) {
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "restart") {
    const state = shards.get(id);
    if (state) state.restarting = true;
    logger.info({ shard: id }, "Shard requested a restart");
  }
}

function handleShardExit(id: number, exitCode: number | null, signalCode: number | null) {
  const state = shards.get(id);
  const restarting = state?.restarting ?? false;

  logger.warn({ shard: id, exitCode, signalCode, restarting }, "Shard process exited");

  if (!restarting) {
    const now = Date.now();
    const crashes = (state?.crashTimestamps ?? []).filter((t) => now - t < CRASH_WINDOW_MS);
    crashes.push(now);
    if (state) state.crashTimestamps = crashes;
    if (crashes.length > MAX_CRASHES_IN_WINDOW) {
      logger.fatal(
        { shard: id },
        "Shard crashed too many times in a short window — giving up on respawning it",
      );
      return;
    }
  }

  setTimeout(
    () => spawnShard(id),
    restarting ? RESTART_RESPAWN_DELAY_MS : CRASH_RESPAWN_DELAY_MS,
  );
}

function shutdown() {
  logger.info("Shard manager shutting down");
  for (const state of shards.values()) {
    state.proc?.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info({ shardCount: SHARD_COUNT }, "Shard manager starting");
for (let id = 0; id < SHARD_COUNT; id++) {
  shards.set(id, { id, proc: null, restarting: false, crashTimestamps: [] });
  spawnShard(id);
}
