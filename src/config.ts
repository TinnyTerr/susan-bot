function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function intList(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => b - a);
}

function roleList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("CLIENT_ID"),
  guildId: optional("GUILD_ID", ""),

  databasePath: optional("DATABASE_PATH", "./data/bot.sqlite"),

  events: {
    defaultChannelId: optional("DEFAULT_EVENT_CHANNEL_ID", ""),
    reminderMinutesBefore: intList("REMINDER_MINUTES_BEFORE", [1440, 60, 15]),
    reminderPollIntervalMs: int("REMINDER_POLL_INTERVAL_MS", 60_000),
    timezone: optional("TIMEZONE", "UTC"),
    locale: optional("LOCALE", "en-US"),
    listMax: int("EVENT_LIST_MAX", 10),
    managerRoleIds: roleList("EVENT_MANAGER_ROLE_IDS"),
    // Emoji are opt-in: leave unset for plain text buttons and headers.
    rsvpEmoji: {
      yes: optional("RSVP_EMOJI_YES", ""),
      maybe: optional("RSVP_EMOJI_MAYBE", ""),
      no: optional("RSVP_EMOJI_NO", ""),
    },
    cleanupHours: int("EVENT_CLEANUP_HOURS", 24),
    advancedRsvpEnabled: bool("EVENT_ADVANCED_RSVP_ENABLED", true),
  },

  cats: {
    // Directory containing one subfolder per cat (e.g. media/cats/susan/).
    mediaDir: optional("CAT_MEDIA_DIR", "./media/cats"),
    // Cat used when /cat is run without a name. Set blank to draw from all cats.
    defaultName: optional("CAT_DEFAULT_NAME", "susan"),
    // Discord's upload limit for bots in non-boosted servers is 10 MB.
    maxUploadBytes: int("CAT_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  },

  quiplash: {
    defaultCategory: optional("QUIPLASH_DEFAULT_CATEGORY", "general"),
    randomDefaultCount: int("QUIPLASH_RANDOM_DEFAULT_COUNT", 10),
    randomMaxCount: int("QUIPLASH_RANDOM_MAX_COUNT", 50),
    managerRoleIds: roleList("QUIPLASH_MANAGER_ROLE_IDS"),
    avoidRepeats: bool("QUIPLASH_AVOID_REPEATS", true),
    cooldownHours: int("QUIPLASH_COOLDOWN_HOURS", 24),
  },

  update: {
    // Comma-separated role IDs allowed to run /git update. Empty = anyone.
    managerRoleIds: roleList("UPDATE_MANAGER_ROLE_IDS"),
    // If "true", the bot periodically checks origin for new commits and
    // automatically pulls + restarts itself when it finds any.
    autoCheckEnabled: bool("AUTO_UPDATE_ENABLED", false),
    pollIntervalMs: int("AUTO_UPDATE_POLL_INTERVAL_MS", 5 * 60_000),
    // Run "bun install" after pulling, in case dependencies changed.
    autoInstall: bool("AUTO_UPDATE_INSTALL_DEPS", true),
  },

  logging: {
    // pino level: trace, debug, info, warn, error, fatal, or silent.
    level: optional("LOG_LEVEL", "info"),
    // Human-readable console output via pino-pretty. Set "false" for raw JSON
    // logs (e.g. when piping into a log aggregator).
    pretty: bool("LOG_PRETTY", true),
    // Channel git pulls/updates and errors are additionally posted to.
    // Leave blank to only log to the console.
    discordChannelId: optional("LOG_CHANNEL_ID", ""),
  },
};

export type Config = typeof config;
