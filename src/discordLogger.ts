import type { Client } from "discord.js";
import { config } from "./config";
import { logger } from "./logger";

let discordClient: Client | null = null;

// Called once the bot logs in, so log messages have a client to send through.
export function setLoggerClient(client: Client) {
  discordClient = client;
}

type DiscordLogLevel = "info" | "warn" | "error";

const LABEL: Record<DiscordLogLevel, string> = {
  info: "Info",
  warn: "Warning",
  error: "Error",
};

// Best-effort mirror of git pull/update activity and errors to a Discord
// channel, in addition to the structured pino logs. Silently does nothing if
// LOG_CHANNEL_ID isn't configured or the bot isn't logged in yet.
export async function logToDiscordChannel(level: DiscordLogLevel, message: string) {
  if (!config.logging.discordChannelId || !discordClient) return;

  try {
    const channel = await discordClient.channels.fetch(config.logging.discordChannelId);
    if (channel && channel.isTextBased() && "send" in channel) {
      await channel.send(`**${LABEL[level]}**: ${message}`);
    }
  } catch (err) {
    logger.error({ err }, "Failed to send log message to Discord channel");
  }
}
