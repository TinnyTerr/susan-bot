import { config } from "./config";
import { db } from "./db";
import { logger } from "./logger";

function cleanupOldEvents() {
  if (config.events.cleanupHours <= 0) return;
  const cutoff = Date.now() - config.events.cleanupHours * 3_600_000;
  db.query("DELETE FROM rsvps WHERE eventId IN (SELECT id FROM events WHERE startTime < ?)").run(cutoff);
  db.query("DELETE FROM events WHERE startTime < ?").run(cutoff);
}

export function startCleanupLoop() {
  const run = () => {
    try {
      cleanupOldEvents();
    } catch (err) {
      logger.error({ err }, "Cleanup loop error");
    }
  };

  run();
  setInterval(run, config.events.cleanupPollIntervalMs);
}
