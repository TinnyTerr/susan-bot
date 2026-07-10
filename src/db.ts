import { Database } from "bun:sqlite";
import { config } from "./config";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    messageId TEXT,
    threadId TEXT,
    name TEXT NOT NULL,
    description TEXT,
    startTime INTEGER NOT NULL,
    creatorId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0
  );
`);

try {
  db.exec(`ALTER TABLE events ADD COLUMN threadId TEXT;`);
} catch {
  // column already exists
}


db.exec(`
  CREATE TABLE IF NOT EXISTS event_reminders_sent (
    eventId INTEGER NOT NULL,
    minutesBefore INTEGER NOT NULL,
    PRIMARY KEY (eventId, minutesBefore)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rsvps (
    eventId INTEGER NOT NULL,
    userId TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
    arrival TEXT,
    departure TEXT,
    note TEXT,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (eventId, userId)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    addedBy TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS prompt_usage (
    promptId INTEGER NOT NULL,
    usedAt INTEGER NOT NULL
  );
`);

export interface EventRow {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  threadId: string | null;
  name: string;
  description: string | null;
  startTime: number;
  creatorId: string;
  createdAt: number;
  cancelled: number;
}

export interface RsvpRow {
  eventId: number;
  userId: string;
  status: "yes" | "maybe" | "no";
  arrival: string | null;
  departure: string | null;
  note: string | null;
  updatedAt: number;
}

export interface PromptRow {
  id: number;
  guildId: string;
  category: string;
  text: string;
  addedBy: string;
  createdAt: number;
}
