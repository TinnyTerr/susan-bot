import { config } from "./config";

export function formatDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat(config.events.locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: config.events.timezone,
    timeZoneName: "short",
  }).format(new Date(epochMs));
}

export function discordTimestamp(epochMs: number, style: "F" | "R" | "f" = "F"): string {
  return `<t:${Math.floor(epochMs / 1000)}:${style}>`;
}
