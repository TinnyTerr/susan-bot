import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { config } from "./config";
import { startAutoUpdateLoop } from "./autoUpdate";
import * as catCommand from "./commands/cat";
import * as eventCommand from "./commands/event";
import * as gitCommand from "./commands/git";
import * as quiplashCommand from "./commands/quiplash";
import { logToDiscordChannel, setLoggerClient } from "./discordLogger";
import { handleGitLogButton } from "./interactions/git";
import { handleRsvpButton, handleRsvpModalSubmit } from "./interactions/rsvp";
import { logger } from "./logger";
import { startReminderLoop } from "./reminders";
import { syncCommands } from "./registerCommands";
import { killStaleInstances } from "./singleInstance";

killStaleInstances();

const commands = new Map<
  string,
  { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }
>([
  [catCommand.data.name, catCommand],
  [eventCommand.data.name, eventCommand],
  [quiplashCommand.data.name, quiplashCommand],
  [gitCommand.data.name, gitCommand],
]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ tag: readyClient.user.tag }, "Logged in");
  setLoggerClient(readyClient);

  try {
    await syncCommands();
    logger.info("Slash commands synced (stale commands removed)");
  } catch (err) {
    logger.error({ err }, "Failed to sync slash commands on startup");
  }

  startReminderLoop(readyClient);
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith("rsvp-modal:")) {
      await handleRsvpModalSubmit(interaction);
      return;
    }
  } catch (err) {
    logger.error({ err, interactionId: interaction.id }, "Error handling interaction");
    await logToDiscordChannel("error", `Error handling an interaction: ${String(err)}`);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.login(config.discordToken);
