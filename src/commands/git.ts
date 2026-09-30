import { defineCommand } from "../utils/defineCommand";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "../config";
import { logToDiscordChannel } from "../discordLogger";
import * as git from "../git";
import {
  buildCommitEmbed,
  buildLogComponents,
  buildLogEmbed,
  buildStatusEmbed,
  buildTreeEmbed,
  formatCommitBlock,
  GIT_LOG_PAGE_SIZE,
} from "../gitView";
import { logger } from "../logger";
import { hasManagerRole } from "../permissions";
import { applyUpdate, checkForUpdates, isUpdateInProgress, scheduleRestart } from "../update";

export const data = new SlashCommandBuilder()
  .setName("git")
  .setDescription("Check for and apply bot code updates from git")
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show the current commit and whether updates are available"),
  )
  .addSubcommand((sub) =>
    sub.setName("update").setDescription("Pull the latest code and restart the bot"),
  )
  .addSubcommand((sub) =>
    sub.setName("log").setDescription("Browse the commit history").addIntegerOption((opt) =>
      opt.setName("page").setDescription("Page number (1-based)").setMinValue(1),
    ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("search")
      .setDescription("Search commit messages")
      .addStringOption((opt) =>
        opt.setName("query").setDescription("Text to search for in commit messages").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("View the details of a specific commit")
      .addStringOption((opt) =>
        opt.setName("hash").setDescription("Commit hash, full or abbreviated").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("tree")
      .setDescription("Browse the repo's file/directory structure")
      .addStringOption((opt) =>
        opt.setName("ref").setDescription("Branch, tag, or commit (defaults to HEAD)"),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "status") {
    await handleStatus(interaction);
  } else if (sub === "update") {
    await handleUpdate(interaction);
  } else if (sub === "log") {
    await handleLog(interaction);
  } else if (sub === "search") {
    await handleSearch(interaction);
  } else if (sub === "show") {
    await handleShow(interaction);
  } else if (sub === "tree") {
    await handleTree(interaction);
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const status = checkForUpdates();
  if (!status) {
    await interaction.editReply("Couldn't read git state — is this running from a git checkout?");
    return;
  }

  await interaction.editReply({ embeds: [buildStatusEmbed(status)], allowedMentions: { parse: [] } });
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

  if (isUpdateInProgress()) {
    await interaction.editReply("An update is already in progress — try again shortly.");
    return;
  }

  const status = checkForUpdates();
  if (!status) {
    await interaction.editReply("Couldn't read git state — is this running from a git checkout?");
    return;
  }
  if (status.dirty) {
    await interaction.editReply(
      "Working tree has uncommitted local changes — refusing to pull. Clean up the checkout first.",
    );
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
    await interaction.editReply({ content: `Update failed: ${result.message}`, allowedMentions: { parse: [] } });
    return;
  }

  await interaction.editReply({
    content: `Update applied. Restarting now...\n${result.message}\n${formatCommitBlock(status.commits)}`,
    allowedMentions: { parse: [] },
  });
  scheduleRestart();
}

async function handleLog(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requestedPage = (interaction.options.getInteger("page") ?? 1) - 1;
  const totalCount = git.countCommits();
  const totalPages = Math.max(1, Math.ceil(totalCount / GIT_LOG_PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);

  const entries = git.queryLog({ skip: page * GIT_LOG_PAGE_SIZE, limit: GIT_LOG_PAGE_SIZE });

  await interaction.editReply({
    embeds: [buildLogEmbed({ mode: "log", entries, page, totalPages, totalCount })],
    components: buildLogComponents("log", page, totalPages),
  });
}

async function handleSearch(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const query = interaction.options.getString("query", true);
  const totalCount = git.countCommits(query);
  const totalPages = Math.max(1, Math.ceil(totalCount / GIT_LOG_PAGE_SIZE));
  const entries = git.queryLog({ grep: query, skip: 0, limit: GIT_LOG_PAGE_SIZE });

  await interaction.editReply({
    embeds: [buildLogEmbed({ mode: "search", query, entries, page: 0, totalPages, totalCount })],
    components: buildLogComponents("search", 0, totalPages, query),
  });
}

async function handleShow(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const hash = interaction.options.getString("hash", true).trim();
  const result = git.showCommit(hash);
  if (!result.ok) {
    await interaction.editReply(result.error);
    return;
  }

  await interaction.editReply({ embeds: [buildCommitEmbed(result.commit)] });
}

async function handleTree(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ref = interaction.options.getString("ref")?.trim() || "HEAD";
  const entries = git.getFileTree(ref);
  if (entries === null) {
    await interaction.editReply("Couldn't resolve that ref — check the branch, tag, or commit name.");
    return;
  }

  await interaction.editReply({ embeds: [buildTreeEmbed(ref, entries)] });
}

export default defineCommand({ data, execute });
