import type { Client } from "discord.js";
import { config } from "../config";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import { db } from "../db";

// Deletes events (and their rsvps) whose startTime is older than
// EVENT_CLEANUP_HOURS. Disabled when that is 0.
export class CleanupManager extends Manager {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(client: Client, registry: ManagerRegistry) {
    super("CleanupManager", client, registry);
  }

  override async ready(): Promise<void> {
    if (config.events.cleanupHours <= 0) return;
    this.run();
    this.timer = setInterval(() => this.run(), config.events.cleanupPollIntervalMs);
  }

  override async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private run() {
    try {
      const cutoff = Date.now() - config.events.cleanupHours * 3_600_000;
      db.query("DELETE FROM rsvps WHERE eventId IN (SELECT id FROM events WHERE startTime < ?)").run(cutoff);
      db.query("DELETE FROM events WHERE startTime < ?").run(cutoff);
    } catch (err) {
      this.log.error({ err }, "Cleanup loop error");
    }
  }
}
