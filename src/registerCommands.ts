import { REST, Routes } from "discord.js";
import { config } from "./config";
import * as catCommand from "./commands/cat";
import * as eventCommand from "./commands/event";
import * as gitCommand from "./commands/git";
import * as quiplashCommand from "./commands/quiplash";

export const commandData = [
  catCommand.data.toJSON(),
  eventCommand.data.toJSON(),
  quiplashCommand.data.toJSON(),
  gitCommand.data.toJSON(),
];

/**
 * Overwrites the full command set with `commandData`. Discord's PUT endpoint
 * replaces everything it's given, so any previously-registered command that
 * doesn't match one of ours (renamed, removed, or left over from an older
 * version of the bot) is deleted as a side effect.
 */
export async function syncCommands(): Promise<void> {
  const rest = new REST().setToken(config.discordToken);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commandData,
    });
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commandData });
  }
}
