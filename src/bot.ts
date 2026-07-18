import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { config } from "./config";
import { startAutoUpdateLoop } from "./autoUpdate";
import { startCleanupLoop } from "./cleanup";
import * as catCommand from "./commands/cat";
import * as eventCommand from "./commands/event";
import * as gitCommand from "./commands/git";
import * as quiplashCommand from "./commands/quiplash";
import { logToDiscordChannel, setLoggerClient } from "./discordLogger";
import { handleGitLogButton } from "./interactions/git";
import { handleQuiplashButton, handleQuiplashModalSubmit } from "./interactions/quiplash";
import { handleRsvpButton, handleRsvpModalSubmit } from "./interactions/rsvp";
import { logger } from "./logger";
import { syncCommands } from "./registerCommands";
import { initSentry, Sentry } from "./sentry";

initSentry();

// This process is a single shard, spawned and supervised by the shard
// manager (src/index.ts). SHARD_ID/SHARD_COUNT are set by the manager even
// when there's only one shard, so restarts always go through it instead of
// this process respawning itself (see scheduleRestart in update.ts).
const shardId = Number(process.env.SHARD_ID ?? 0);
const shardCount = Number(process.env.SHARD_COUNT ?? 1);

const commands = new Map<
  string,
  { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }
>([
  [catCommand.data.name, catCommand],
  [eventCommand.data.name, eventCommand],
  [quiplashCommand.data.name, quiplashCommand],
  [gitCommand.data.name, gitCommand],
]);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  shards: [shardId],
  shardCount,
});

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ tag: readyClient.user.tag, shardId, shardCount }, "Logged in");
  setLoggerClient(readyClient);

  try {
    await syncCommands();
    logger.info("Slash commands synced (stale commands removed)");
  } catch (err) {
    logger.error({ err }, "Failed to sync slash commands on startup");
  }

  startCleanupLoop();
  startAutoUpdateLoop(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      if (interaction.commandName === catCommand.data.name) {
        await catCommand.autocomplete(interaction);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("rsvp:")) {
      await handleRsvpButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("gitlog:")) {
      await handleGitLogButton(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("quiplash:")) {
      await handleQuiplashButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("rsvp-modal:")) {
      await handleRsvpModalSubmit(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "quiplash-add-modal") {
      await handleQuiplashModalSubmit(interaction);
      return;
    }
  } catch (err) {
    logger.error({ err, interactionId: interaction.id }, "Error handling interaction");
    Sentry.captureException(err);
    await logToDiscordChannel("error", `Error handling an interaction: ${String(err)}`);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

// The manager kills this process (SIGTERM) on shutdown, and also to replace
// it after a restart request — shut the client down cleanly either way.
process.on("SIGTERM", () => {
  logger.info({ shardId }, "Shard received SIGTERM, shutting down");
  client.destroy();
  process.exit(0);
});

client.login(config.discordToken);
