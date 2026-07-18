import * as Sentry from "@sentry/bun";
import { config } from "./config";

// Each process (the shard manager in index.ts, and every shard child spawned
// from bot.ts) initializes its own Sentry instance since they're separate
// Bun processes. No-ops when SENTRY_DSN is unset.
export function initSentry() {
  if (!config.sentry.dsn || config.sentry.dsn === "disabled") return;

  Sentry.init({
    dsn: config.sentry.dsn,
    enableLogs: true,
    tracesSampleRate: 1.0,
  });
}

export { Sentry };
