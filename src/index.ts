import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { config } from "./config";
import * as catCommand from "./commands/cat";
import * as eventCommand from "./commands/event";
import * as quiplashCommand from "./commands/quiplash";
import { handleRsvpButton, handleRsvpModalSubmit } from "./interactions/rsvp";
import { startReminderLoop } from "./reminders";
import { syncCommands } from "./registerCommands";

const commands = new Map<
  string,
  { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }
>([
  [catCommand.data.name, catCommand],
  [eventCommand.data.name, eventCommand],
  [quiplashCommand.data.name, quiplashCommand],
]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  try {
    await syncCommands();
    console.log("Slash commands synced (stale commands removed).");
  } catch (err) {
    console.error("Failed to sync slash commands on startup:", err);
  }

  startReminderLoop(readyClient);
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith("rsvp-modal:")) {
      await handleRsvpModalSubmit(interaction);
      return;
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.login(config.discordToken);
