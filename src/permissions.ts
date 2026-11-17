import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { config } from "./config";

type MemberBearingInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;

// Bot-wide admins, identified by Discord user ID, bypass every manager-role
// check regardless of command. Configured via ADMIN_USER_IDS.
export function isAdmin(interaction: MemberBearingInteraction): boolean {
  const userId = interaction.user?.id;
  return userId !== undefined && config.adminUserIds.includes(userId);
}

export function hasManagerRole(
  interaction: MemberBearingInteraction,
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

// Cat upload moderation. Unlike the other manager checks, an empty role list
// means admins only — an open review queue would let anyone approve anything.
export function canManageCatUploads(interaction: MemberBearingInteraction): boolean {
  if (isAdmin(interaction)) return true;
  if (config.web.managerRoleIds.length === 0) return false;
  return hasManagerRole(interaction, config.web.managerRoleIds);
}
