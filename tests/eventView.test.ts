import { describe, expect, test } from "bun:test";
import { buildEventComponents, buildEventEmbed } from "../src/eventView";
import { db, type EventRow } from "../src/db";

function insertEvent(overrides: Partial<EventRow> = {}): EventRow {
  const result = db
    .query(
      "INSERT INTO events (guildId, channelId, name, description, startTime, creatorId, createdAt, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      overrides.guildId ?? "guild-1",
      overrides.channelId ?? "channel-1",
      overrides.name ?? "Movie night",
      overrides.description ?? null,
      overrides.startTime ?? 1700000000000,
      overrides.creatorId ?? "user-1",
      overrides.createdAt ?? Date.now(),
      overrides.cancelled ?? 0,
    );
  const id = Number(result.lastInsertRowid);
  return db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(id)!;
}

describe("buildEventComponents", () => {
  test("includes yes/maybe/no buttons plus the advanced RSVP button", () => {
    const rows = buildEventComponents(42);
    const customIds = rows.flatMap((row) =>
      row.toJSON().components.map((c) => ("custom_id" in c ? c.custom_id : undefined)),
    );
    expect(customIds).toEqual([
      "rsvp:yes:42",
      "rsvp:maybe:42",
      "rsvp:no:42",
      "rsvp:details:42",
    ]);
  });
});

describe("buildEventEmbed", () => {
  test("shows zero counts and placeholders with no RSVPs", () => {
    const event = insertEvent({ name: "Empty event" });
    const embed = buildEventEmbed(event).toJSON();

    expect(embed.title).toBe("Empty event");
    expect(embed.color).toBe(0x5865f2);
    const goingField = embed.fields!.find((f) => f.name.startsWith("Going"));
    expect(goingField!.name).toBe("Going (0)");
    expect(goingField!.value).toBe("—");
  });

  test("buckets RSVPs by status and shows arrival/departure/notes", () => {
    const event = insertEvent({ name: "Party" });
    const now = Date.now();
    db.query(
      "INSERT INTO rsvps (eventId, userId, status, arrival, departure, note, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(event.id, "user-yes", "yes", "7pm", "10pm", "bringing snacks", now);
    db.query(
      "INSERT INTO rsvps (eventId, userId, status, updatedAt) VALUES (?, ?, ?, ?)",
    ).run(event.id, "user-maybe", "maybe", now);

    const embed = buildEventEmbed(event).toJSON();
    const goingField = embed.fields!.find((f) => f.name.startsWith("Going"))!;
    expect(goingField.name).toBe("Going (1)");
    expect(goingField.value).toBe(
      '<@user-yes> (arrives 7pm, leaves 10pm, "bringing snacks")',
    );

    const maybeField = embed.fields!.find((f) => f.name.startsWith("Maybe"))!;
    expect(maybeField.name).toBe("Maybe (1)");
    expect(maybeField.value).toBe("<@user-maybe>");

    const cantGoField = embed.fields!.find((f) => f.name.startsWith("Can't go"))!;
    expect(cantGoField.name).toBe("Can't go (0)");
  });

  test("marks cancelled events in the footer and color", () => {
    const event = insertEvent({ name: "Cancelled thing", cancelled: 1 });
    const embed = buildEventEmbed(event).toJSON();
    expect(embed.color).toBe(0x808080);
    expect(embed.footer!.text).toBe(`Event #${event.id} • CANCELLED`);
  });

  test("includes description only when present", () => {
    const withDescription = insertEvent({ name: "Has desc", description: "bring chips" });
    expect(buildEventEmbed(withDescription).toJSON().description).toBe("bring chips");

    const withoutDescription = insertEvent({ name: "No desc" });
    expect(buildEventEmbed(withoutDescription).toJSON().description).toBeUndefined();
  });
});
