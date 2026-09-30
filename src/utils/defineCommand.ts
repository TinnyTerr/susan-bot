import type { Command } from "../types/command";

// Identity helper that just gives you type-checking + autocomplete when authoring a command file.
export function defineCommand(command: Command): Command {
  return command;
}
