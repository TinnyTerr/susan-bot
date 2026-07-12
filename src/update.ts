import { spawnSync } from "bun";
import { config } from "./config";
import { logToDiscordChannel } from "./discordLogger";
import * as git from "./git";
import { logger } from "./logger";

export interface UpdateStatus {
  branch: string;
  localCommit: string;
  remoteCommit: string | null;
  commits: string[];
  dirty: boolean;
}

// Fetches from origin and compares HEAD to the tracked branch. Returns null
// if this isn't a git checkout (e.g. `rev-parse` fails).
export function checkForUpdates(): UpdateStatus | null {
  const branch = git.getCurrentBranch();
  const localCommit = git.getCurrentCommit();
  if (!branch || !localCommit) return null;

  const fetchResult = git.fetchRemote();
  if (!fetchResult.ok) {
    logger.error({ stderr: fetchResult.stderr }, "git fetch failed");
  }

  const remoteCommit = git.getRemoteCommit(branch);
  const commits =
    remoteCommit && remoteCommit !== localCommit
      ? git.getCommitLog(localCommit, remoteCommit)
      : [];

  return { branch, localCommit, remoteCommit, commits, dirty: git.hasLocalChanges() };
}

export interface ApplyUpdateResult {
  ok: boolean;
  message: string;
}

// Guards against two updates racing each other — the auto-update loop and a
// manual /git update, or two concurrent manual invocations — pulling,
// installing, and restarting at the same time.
let updateInProgress = false;

export function isUpdateInProgress(): boolean {
  return updateInProgress;
}

// Pulls (fast-forward only) and, if configured, reinstalls dependencies.
// Refuses to run if there are uncommitted local changes or an update is
// already running. Logs the outcome (pull, install, or failure) to pino and,
// if configured, to LOG_CHANNEL_ID.
export function applyUpdate(): ApplyUpdateResult {
  if (updateInProgress) {
    const message = "An update is already in progress.";
    logger.warn(message);
    return { ok: false, message };
  }
  updateInProgress = true;
  try {
    const branch = git.getCurrentBranch();
    if (!branch) {
      const message = "Could not determine current git branch.";
      logger.error(message);
      logToDiscordChannel("error", message).catch(() => {});
      return { ok: false, message };
    }

    if (git.hasLocalChanges()) {
      const message = "Working tree has uncommitted local changes — refusing to pull.";
      logger.warn(message);
      logToDiscordChannel("warn", message).catch(() => {});
      return { ok: false, message };
    }

    logger.info({ branch }, "Pulling latest changes");
    const pullResult = git.pull(branch);
    if (!pullResult.ok) {
      const message = `git pull failed: ${pullResult.stderr || pullResult.stdout}`;
      logger.error({ branch, stderr: pullResult.stderr }, "git pull failed");
      logToDiscordChannel("error", message).catch(() => {});
      return { ok: false, message };
    }
    logger.info({ branch, result: pullResult.stdout }, "git pull complete");
    logToDiscordChannel(
      "info",
      `Pulled \`${branch}\`: ${pullResult.stdout || "already up to date"}`,
    ).catch(() => {});

    if (config.update.autoInstall) {
      const install = spawnSync({ cmd: ["bun", "install"], stdout: "pipe", stderr: "pipe" });
      if (!install.success) {
        const message = `git pull succeeded but "bun install" failed: ${install.stderr.toString().trim()}`;
        logger.error({ branch }, `bun install failed: ${install.stderr.toString().trim()}`);
        logToDiscordChannel("error", message).catch(() => {});
        return { ok: false, message };
      }
      logger.info({ branch }, "bun install complete");
    }

    return { ok: true, message: pullResult.stdout || "Already up to date." };
  } finally {
    updateInProgress = false;
  }
}

// Asks the shard manager (src/index.ts, our parent process) to respawn this
// shard, then exits. The manager stays running throughout — it spawns a
// fresh shard process once this one exits — so a restart never leaves an
// orphaned process behind the way self-respawning did.
export function scheduleRestart(delayMs = 1000) {
  logger.info({ delayMs }, "Requesting restart from shard manager");
  setTimeout(() => {
    const send = (process as unknown as { send?: (message: unknown) => void }).send;
    if (!send) {
      logger.error("No IPC channel to a shard manager — cannot request a restart.");
      return;
    }
    send({ type: "restart" });
    process.exit(0);
  }, delayMs);
}
