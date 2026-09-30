import type { Client } from "discord.js";
import { config } from "../config";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import { logToDiscordChannel } from "../discordLogger";
import { applyUpdate, checkForUpdates, scheduleRestart } from "../update";

// Periodically checks origin for new commits on the current branch and, if
// enabled, pulls + restarts automatically. Off by default (AUTO_UPDATE_ENABLED).
export class UpdateManager extends Manager {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(client: Client, registry: ManagerRegistry) {
    super("UpdateManager", client, registry);
  }

  override async ready(): Promise<void> {
    if (!config.update.autoCheckEnabled) return;

    this.log.info({ pollIntervalMs: config.update.pollIntervalMs }, "Auto-update loop started");
    const tick = () => this.check().catch((err) => this.log.error({ err }, "Auto-update loop error"));
    void tick();
    this.timer = setInterval(tick, config.update.pollIntervalMs);
  }

  override async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async check() {
    const status = checkForUpdates();
    if (!status || !status.remoteCommit || status.remoteCommit === status.localCommit) return;

    if (status.dirty) {
      this.log.warn("Auto-update: new commits available but working tree is dirty, skipping.");
      return;
    }

    const message = `Auto-update: ${status.commits.length} new commit(s) on ${status.branch}, applying...`;
    this.log.info({ branch: status.branch, commits: status.commits }, message);
    await logToDiscordChannel("info", message);

    // applyUpdate already logs the specific failure.
    if (!applyUpdate().ok) return;

    this.log.info("Auto-update applied, restarting.");
    scheduleRestart();
  }
}
