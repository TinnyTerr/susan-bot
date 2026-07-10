import { describe, expect, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { execute } from "../src/commands/quiplash";
import { db } from "../src/db";

interface FakeReply {
  content?: string;
  flags?: number;
}

function fakeInteraction(opts: {
  sub: string;
  guildId?: string;
  userId?: string;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  managerRole?: boolean;
}): { interaction: ChatInputCommandInteraction; replies: FakeReply[] } {
  const replies: FakeReply[] = [];
  const interaction = {
    guildId: opts.guildId ?? "guild-quiplash",
    user: { id: opts.userId ?? "user-1" },
    member: opts.managerRole === false ? { roles: [] } : { roles: ["manager-role"] },
    options: {
      getSubcommand: () => opts.sub,
      getString: (name: string, required?: boolean) => {
        const value = opts.strings?.[name] ?? null;
        if (required && value === null) throw new Error(`missing required string ${name}`);
        return value;
      },
      getInteger: (name: string, required?: boolean) => {
        const value = opts.integers?.[name] ?? null;
        if (required && value === null) throw new Error(`missing required integer ${name}`);
        return value;
      },
    },
    reply: async (payload: FakeReply) => {
      replies.push(payload);
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

describe("/quiplash add", () => {
  test("stores a prompt under the given category", async () => {
    const { interaction, replies } = fakeInteraction({
      sub: "add",
      strings: { prompt: "Best cat nap spot?", category: "Cats" },
    });
    await execute(interaction);

    expect(replies[0]!.content).toContain('Added prompt #');
    expect(replies[0]!.content).toContain("**cats**");

    const row = db
      .query<{ text: string; category: string }, [string]>(
        "SELECT text, category FROM prompts WHERE guildId = ? ORDER BY id DESC LIMIT 1",
      )
      .get("guild-quiplash");
    expect(row!.text).toBe("Best cat nap spot?");
    expect(row!.category).toBe("cats");
  });

  test("rejects non-managers", async () => {
    const { interaction, replies } = fakeInteraction({
      sub: "add",
      strings: { prompt: "Should not be added" },
      managerRole: false,
    });
    await execute(interaction);
    expect(replies[0]!.content).toContain("don't have permission");
  });
});

describe("/quiplash random with repeat-avoidance", () => {
  test("excludes recently-used prompts until the pool is exhausted", async () => {
    const guildId = "guild-repeat-test";
    const { interaction: addA } = fakeInteraction({
      sub: "add",
      guildId,
      strings: { prompt: "Prompt A", category: "party" },
    });
    await execute(addA);
    const { interaction: addB } = fakeInteraction({
      sub: "add",
      guildId,
      strings: { prompt: "Prompt B", category: "party" },
    });
    await execute(addB);

    const { interaction: draw1, replies: replies1 } = fakeInteraction({
      sub: "random",
      guildId,
      integers: { count: 1 },
      strings: { category: "party" },
    });
    await execute(draw1);
    const firstDraw = replies1[0]!.content!;

    const { interaction: draw2, replies: replies2 } = fakeInteraction({
      sub: "random",
      guildId,
      integers: { count: 1 },
      strings: { category: "party" },
    });
    await execute(draw2);
    const secondDraw = replies2[0]!.content!;

    // With avoidRepeats on and a pool of 2, drawing 1 twice must not repeat
    // the same prompt until the whole pool has been used once.
    expect(firstDraw).not.toBe(secondDraw);
  });

  test("replies with a message when no prompts exist for a category", async () => {
    const { interaction, replies } = fakeInteraction({
      sub: "random",
      guildId: "guild-empty",
      strings: { category: "nonexistent" },
    });
    await execute(interaction);
    expect(replies[0]!.content).toContain("No prompts stored in category");
  });
});

describe("/quiplash remove", () => {
  test("removes an existing prompt and its usage history", async () => {
    const guildId = "guild-remove-test";
    const { interaction: add } = fakeInteraction({
      sub: "add",
      guildId,
      strings: { prompt: "Removable prompt" },
    });
    await execute(add);

    const inserted = db
      .query<{ id: number }, [string]>("SELECT id FROM prompts WHERE guildId = ? ORDER BY id DESC LIMIT 1")
      .get(guildId)!;

    const { interaction: remove, replies } = fakeInteraction({
      sub: "remove",
      guildId,
      integers: { id: inserted.id },
    });
    await execute(remove);

    expect(replies[0]!.content).toContain(`Removed prompt #${inserted.id}`);
    const stillThere = db
      .query<{ id: number }, [number]>("SELECT id FROM prompts WHERE id = ?")
      .get(inserted.id);
    expect(stillThere).toBeNull();
  });

  test("rejects non-managers", async () => {
    const { interaction, replies } = fakeInteraction({
      sub: "remove",
      integers: { id: 1 },
      managerRole: false,
    });
    await execute(interaction);
    expect(replies[0]!.content).toContain("don't have permission");
  });
});

describe("/quiplash list", () => {
  test("lists prompts for the guild", async () => {
    const guildId = "guild-list-test";
    const { interaction: add } = fakeInteraction({
      sub: "add",
      guildId,
      strings: { prompt: "Listed prompt", category: "misc" },
    });
    await execute(add);

    const { interaction: list, replies } = fakeInteraction({ sub: "list", guildId });
    await execute(list);
    expect(replies[0]!.content).toContain("Listed prompt");
    expect(replies[0]!.content).toContain("[misc]");
  });

  test("reports when no prompts are found", async () => {
    const { interaction, replies } = fakeInteraction({ sub: "list", guildId: "guild-no-prompts" });
    await execute(interaction);
    expect(replies[0]!.content).toBe("No prompts found.");
  });
});
