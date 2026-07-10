import type { ChatInputCommandInteraction } from "discord.js";

export function hasManagerRole(
  interaction: ChatInputCommandInteraction,
  roleIds: string[],
): boolean {
  if (roleIds.length === 0) return true;
  const member = interaction.member;
  if (!member || !("roles" in member)) return false;
  const memberRoles = member.roles;
  if (Array.isArray(memberRoles)) {
    return memberRoles.some((r) => roleIds.includes(r));
  }
  return roleIds.some((id) => memberRoles.cache.has(id));
}
