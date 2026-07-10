import type { Client } from "discord.js";
import { config } from "./config";
import { logToDiscordChannel } from "./discordLogger";
import { logger } from "./logger";
import { applyUpdate, checkForUpdates, scheduleRestart } from "./update";

// Periodically checks origin for new commits on the current branch and, if
// enabled, pulls + restarts automatically. Off by default (AUTO_UPDATE_ENABLED).
export function startAutoUpdateLoop(client: Client) {
  if (!config.update.autoCheckEnabled) return;

  logger.info(
    { pollIntervalMs: config.update.pollIntervalMs },
    "Auto-update loop started",
  );

  const check = async () => {
    const status = checkForUpdates();
    if (!status || !status.remoteCommit || status.remoteCommit === status.localCommit) return;

    if (status.dirty) {
      logger.warn("Auto-update: new commits available but working tree is dirty, skipping.");
      return;
    }

    const message = `Auto-update: ${status.commits.length} new commit(s) on ${status.branch}, applying...`;
    logger.info({ branch: status.branch, commits: status.commits }, message);
    await logToDiscordChannel("info", message);

    const result = applyUpdate();
    if (!result.ok) {
      // applyUpdate already logged the specific failure.
      return;
    }

    logger.info("Auto-update applied, restarting.");
    scheduleRestart();
  };

  check().catch((err) => logger.error({ err }, "Auto-update loop error"));
  setInterval(() => {
    check().catch((err) => logger.error({ err }, "Auto-update loop error"));
  }, config.update.pollIntervalMs);
}
