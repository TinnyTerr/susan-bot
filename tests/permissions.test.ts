import { describe, expect, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { hasManagerRole } from "../src/permissions";

function interactionWithRoles(
  roles: string[] | { cache: { has(id: string): boolean } } | null,
): ChatInputCommandInteraction {
  return {
    member: roles === null ? null : { roles },
  } as unknown as ChatInputCommandInteraction;
}

describe("hasManagerRole", () => {
  test("allows anyone when the manager role list is empty", () => {
    expect(hasManagerRole(interactionWithRoles([]), [])).toBe(true);
    expect(hasManagerRole(interactionWithRoles(null), [])).toBe(true);
  });

  test("denies when there is no member on the interaction", () => {
    expect(hasManagerRole(interactionWithRoles(null), ["role-1"])).toBe(false);
  });

  test("array-shaped roles: allows when a role matches", () => {
    const interaction = interactionWithRoles(["role-1", "role-2"]);
    expect(hasManagerRole(interaction, ["role-2"])).toBe(true);
  });

  test("array-shaped roles: denies when no role matches", () => {
    const interaction = interactionWithRoles(["role-1"]);
    expect(hasManagerRole(interaction, ["role-2"])).toBe(false);
  });

  test("cache-shaped roles (real GuildMemberRoleManager): allows on match", () => {
    const interaction = interactionWithRoles({
      cache: { has: (id: string) => id === "role-9" },
    });
    expect(hasManagerRole(interaction, ["role-1", "role-9"])).toBe(true);
  });

  test("cache-shaped roles: denies when none of the manager roles are present", () => {
    const interaction = interactionWithRoles({
      cache: { has: () => false },
    });
    expect(hasManagerRole(interaction, ["role-1", "role-9"])).toBe(false);
  });
});
