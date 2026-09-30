import { join } from "node:path";
import { REST, Routes, type AutocompleteInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { config } from "../config";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import type { Command } from "../types/command";
import { loadFiles } from "../utils/loadFiles";

export function loadCommands(): Promise<Command[]> {
  return loadFiles<Command>(join(import.meta.dir, "..", "commands"));
}

/**
 * Overwrites the full command set with `commands`. Discord's PUT endpoint
 * replaces everything it's given, so any previously-registered command that
 * doesn't match one of ours (renamed, removed, or left over from an older
 * version of the bot) is deleted as a side effect.
 */
export async function syncCommands(commands: Command[]): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  const body = commands.map((c) => c.data.toJSON());

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
  }
}

export class CommandManager extends Manager {
  readonly commands = new Map<string, Command>();

  constructor(client: Client, registry: ManagerRegistry) {
    super("CommandManager", client, registry);
  }

  override async init(): Promise<void> {
    for (const command of await loadCommands()) {
      this.commands.set(command.data.name, command);
    }
    this.log.info({ names: [...this.commands.keys()] }, `Loaded ${this.commands.size} command(s)`);
  }

  override async ready(): Promise<void> {
    try {
      await syncCommands([...this.commands.values()]);
      this.log.info("Slash commands synced (stale commands removed)");
    } catch (err) {
      this.log.error({ err }, "Failed to sync slash commands on startup");
    }
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  }

  async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await this.commands.get(interaction.commandName)?.autocomplete?.(interaction);
  }
}
