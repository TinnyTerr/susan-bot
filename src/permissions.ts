import type { ChatInputCommandInteraction } from "discord.js";
import { config } from "./config";

// Bot-wide admins, identified by Discord user ID, bypass every manager-role
// check regardless of command. Configured via ADMIN_USER_IDS.
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const userId = interaction.user?.id;
  return userId !== undefined && config.adminUserIds.includes(userId);
}

export function hasManagerRole(
  interaction: ChatInputCommandInteraction,
  roleIds: string[],
): boolean {
  if (isAdmin(interaction)) return true;
  if (roleIds.length === 0) return true;
  const member = interaction.member;
  if (!member || !("roles" in member)) return false;
  const memberRoles = member.roles;
  if (Array.isArray(memberRoles)) {
    return memberRoles.some((r) => roleIds.includes(r));
  }
  return roleIds.some((id) => memberRoles.cache.has(id));
}
