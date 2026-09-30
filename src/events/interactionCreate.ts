import { Events, MessageFlags } from "discord.js";
import { logToDiscordChannel } from "../discordLogger";
import { logger } from "../logger";
import type { CommandManager } from "../managers/CommandManager";
import type { InteractionManager } from "../managers/InteractionManager";
import { defineEvent } from "../utils/defineEvent";

export default defineEvent({
  name: Events.InteractionCreate,
  async execute(registry, _client, interaction) {
    const commands = registry.get<CommandManager>("CommandManager");
    const components = registry.get<InteractionManager>("InteractionManager");

    try {
      if (interaction.isChatInputCommand()) await commands.handleCommand(interaction);
      else if (interaction.isAutocomplete()) await commands.handleAutocomplete(interaction);
      else if (interaction.isButton()) await components.handleButton(interaction);
      else if (interaction.isModalSubmit()) await components.handleModal(interaction);
    } catch (err) {
      logger.error({ err, interactionId: interaction.id }, "Error handling interaction");
      await logToDiscordChannel("error", `Error handling an interaction: ${String(err)}`);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  },
});
