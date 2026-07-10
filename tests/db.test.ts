import { describe, expect, test } from "bun:test";
import { db, type EventRow, type PromptRow, type RsvpRow } from "../src/db";

describe("events table", () => {
  test("inserts and reads back a row with expected defaults", () => {
    const result = db
      .query(
        "INSERT INTO events (guildId, channelId, name, startTime, creatorId, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("guild-1", "channel-1", "Board games", 1700000000000, "user-1", Date.now());

    const id = Number(result.lastInsertRowid);
    const event = db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(id);

    expect(event).not.toBeNull();
    expect(event!.name).toBe("Board games");
    expect(event!.cancelled).toBe(0);
    expect(event!.messageId).toBeNull();
  });
});

describe("rsvps table", () => {
  // eventId values here are arbitrary (rsvps has no FK constraint back to
  // events) — use a range well away from the auto-incrementing event ids
  // other test files create, since the sqlite db is shared across files.
  test("enforces status CHECK constraint", () => {
    expect(() =>
      db
        .query(
          "INSERT INTO rsvps (eventId, userId, status, updatedAt) VALUES (?, ?, ?, ?)",
        )
        .run(900001, "user-1", "invalid-status", Date.now()),
    ).toThrow();
  });

  test("accepts valid statuses and enforces one rsvp per user per event", () => {
    db.query(
      "INSERT INTO rsvps (eventId, userId, status, updatedAt) VALUES (?, ?, ?, ?)",
    ).run(900002, "user-2", "yes", Date.now());

    expect(() =>
      db
        .query(
          "INSERT INTO rsvps (eventId, userId, status, updatedAt) VALUES (?, ?, ?, ?)",
        )
        .run(900002, "user-2", "no", Date.now()),
    ).toThrow();

    const rsvp = db
      .query<RsvpRow, [number, string]>("SELECT * FROM rsvps WHERE eventId = ? AND userId = ?")
      .get(900002, "user-2");
    expect(rsvp!.status).toBe("yes");
  });
});

describe("prompts and prompt_usage tables", () => {
  test("inserts a prompt and tracks usage independently", () => {
    const result = db
      .query(
        "INSERT INTO prompts (guildId, category, text, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)",
      )
      .run("guild-1", "general", "What is Susan's favorite toy?", "user-1", Date.now());

    const promptId = Number(result.lastInsertRowid);
    const prompt = db.query<PromptRow, [number]>("SELECT * FROM prompts WHERE id = ?").get(promptId);
    expect(prompt!.category).toBe("general");

    db.query("INSERT INTO prompt_usage (promptId, usedAt) VALUES (?, ?)").run(promptId, Date.now());
    const usageCount = db
      .query<{ count: number }, [number]>("SELECT COUNT(*) as count FROM prompt_usage WHERE promptId = ?")
      .get(promptId);
    expect(usageCount!.count).toBe(1);
  });
});
