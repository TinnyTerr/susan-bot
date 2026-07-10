import type { Client } from "discord.js";
import { config } from "./config";
import { db, type EventRow, type RsvpRow } from "./db";
import { discordTimestamp } from "./formatting";
import { logger } from "./logger";

function attendeesLine(eventId: number): string {
  const rsvps = db
    .query<RsvpRow, [number]>("SELECT * FROM rsvps WHERE eventId = ? AND status IN ('yes','maybe')")
    .all(eventId);
  if (rsvps.length === 0) return "";
  return rsvps.map((r) => `<@${r.userId}>`).join(" ");
}

async function sendReminder(client: Client, event: EventRow, minutesBefore: number) {
  const channel = await client.channels.fetch(event.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const when =
    minutesBefore >= 60
      ? `${Math.round(minutesBefore / 60)} hour(s)`
      : `${minutesBefore} minute(s)`;

  const mentions = attendeesLine(event.id);
  await channel.send({
    content:
      `Reminder: **${event.name}** starts in ${when} (${discordTimestamp(event.startTime, "R")}).` +
      (mentions ? `\n${mentions}` : ""),
  });
}

export function startReminderLoop(client: Client) {
  const check = async () => {
    const now = Date.now();

    for (const minutesBefore of config.events.reminderMinutesBefore) {
      const windowStart = now;
      const windowEnd = now + config.events.reminderPollIntervalMs;
      const targetStart = windowStart + minutesBefore * 60_000;
      const targetEnd = windowEnd + minutesBefore * 60_000;

      const dueEvents = db
        .query<
          EventRow,
          [number, number]
        >(
          `SELECT * FROM events WHERE cancelled = 0 AND startTime >= ? AND startTime < ?`,
        )
        .all(targetStart, targetEnd);

      for (const event of dueEvents) {
        const alreadySent = db
          .query<{ eventId: number }, [number, number]>(
            "SELECT eventId FROM event_reminders_sent WHERE eventId = ? AND minutesBefore = ?",
          )
          .get(event.id, minutesBefore);
        if (alreadySent) continue;

        await sendReminder(client, event, minutesBefore);
        db.query(
          "INSERT INTO event_reminders_sent (eventId, minutesBefore) VALUES (?, ?)",
        ).run(event.id, minutesBefore);
      }
    }

    if (config.events.cleanupHours > 0) {
      const cutoff = now - config.events.cleanupHours * 3_600_000;
      db.query("DELETE FROM event_reminders_sent WHERE eventId IN (SELECT id FROM events WHERE startTime < ?)").run(cutoff);
      db.query("DELETE FROM rsvps WHERE eventId IN (SELECT id FROM events WHERE startTime < ?)").run(cutoff);
      db.query("DELETE FROM events WHERE startTime < ?").run(cutoff);
    }
  };

  check().catch((err) => logger.error({ err }, "Reminder loop error"));
  setInterval(() => {
    check().catch((err) => logger.error({ err }, "Reminder loop error"));
  }, config.events.reminderPollIntervalMs);
}
