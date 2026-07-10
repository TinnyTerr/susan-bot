import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config";
import { logToDiscordChannel } from "../discordLogger";
import { logger } from "../logger";
import { hasManagerRole } from "../permissions";
import { applyUpdate, checkForUpdates, scheduleRestart } from "../update";

export const data = new SlashCommandBuilder()
  .setName("git")
  .setDescription("Check for and apply bot code updates from git")
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show the current commit and whether updates are available"),
  )
  .addSubcommand((sub) =>
    sub.setName("update").setDescription("Pull the latest code and restart the bot"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "status") {
    await handleStatus(interaction);
  } else if (sub === "update") {
    await handleUpdate(interaction);
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = checkForUpdates();
  if (!status) {
    await interaction.editReply("Couldn't read git state — is this running from a git checkout?");
    return;
  }

  const lines = [`Branch: \`${status.branch}\``, `Local commit: \`${status.localCommit.slice(0, 7)}\``];

  if (status.remoteCommit) {
    lines.push(`Remote commit: \`${status.remoteCommit.slice(0, 7)}\``);
    lines.push(
      status.commits.length > 0
        ? `${status.commits.length} commit(s) behind:\n${status.commits.map((c) => `- ${c}`).join("\n")}`
        : "Up to date with origin.",
    );
  } else {
    lines.push("Could not reach the remote to check for updates.");
  }

  if (status.dirty) {
    lines.push("Warning: working tree has local changes not tracked by git.");
  }

  await interaction.editReply(lines.join("\n"));
}

async function handleUpdate(interaction: ChatInputCommandInteraction) {
  if (!hasManagerRole(interaction, config.update.managerRoleIds)) {
    await interaction.reply({
      content: "You don't have permission to update the bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const status = checkForUpdates();
  if (!status) {
    await interaction.editReply("Couldn't read git state — is this running from a git checkout?");
    return;
  }
  if (status.remoteCommit === status.localCommit) {
    await interaction.editReply("Already up to date — nothing to pull.");
    return;
  }

  logger.info(
    { userId: interaction.user.id, branch: status.branch },
    "/git update invoked",
  );
  await logToDiscordChannel(
    "info",
    `/git update started by <@${interaction.user.id}> (${status.commits.length} commit(s) behind).`,
  );

  const result = applyUpdate();
  if (!result.ok) {
    await interaction.editReply(`Update failed: ${result.message}`);
    return;
  }

  await interaction.editReply(`Update applied. Restarting now...\n${result.message}`);
  scheduleRestart();
}
