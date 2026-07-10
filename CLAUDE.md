# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hangout Bot** is a Discord bot for scheduling events with RSVPs and managing Quiplash-style game prompts. Built with Bun + TypeScript using discord.js and bun:sqlite (local SQLite storage, no external database).

Built as a tribute to Susan, the owner's late cat.

Three main commands:
- **`/event`**: create/list/info/cancel events with two-tier RSVP system (basic Go/Maybe/No, or advanced with arrival/departure times and notes)
- **`/quiplash`**: add/import/list/remove game prompts by category, draw random prompts with repeat-avoidance via cooldown tracking
- **`/cat`**: posts a random photo/video from a per-cat media folder (`CAT_MEDIA_DIR/<name>/`); defaults to `CAT_DEFAULT_NAME` (susan), `name:any` picks a random cat. No database — reads the filesystem on each call.

Tone: bot messages are plain text — no decorative emojis. RSVP emoji are opt-in via `RSVP_EMOJI_*` env vars (blank by default).

## Development Commands

```bash
bun run dev              # Auto-restart on changes
bun run start            # Run the bot
bun run deploy-commands  # Sync slash commands with Discord (useful before starting bot)
```

All three commands use `src/index.ts` (dev/start) or `src/deploy-commands.ts` (deploy-commands) as entry points.

## Setup

1. Create Discord application + bot at https://discord.com/developers/applications — copy **token** and **application ID**
2. Invite bot to server with `applications.commands` + `bot` scopes (permissions: Send Messages, Embed Links, Read Message History)
3. `bun install`
4. `cp .env.example .env` and fill `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (guild ID speeds up command registration to ~5 sec instead of 1 hour)
5. `bun run dev` or `bun run start`

On startup, the bot syncs slash commands — any stale commands from older versions are deleted automatically.

## High-Level Architecture

**Entry Point (`src/index.ts`)**
- Initializes Discord client with guild intents
- Routes interactions: slash commands → `commands/` map, buttons/modals → `interactions/rsvp.ts`
- Starts reminder loop on ready

**Command System**
- `src/commands/event.ts`, `src/commands/quiplash.ts`, and `src/commands/cat.ts` export `data` (SlashCommandBuilder) and `execute(interaction)`; `cat.ts` also exports `autocomplete(interaction)` for cat-name suggestions (routed in `index.ts`)
- `src/registerCommands.ts` syncs commands to Discord on startup (fetches live commands, removes stale ones, creates/updates as needed)
- `src/deploy-commands.ts` does the same sync standalone (useful for debugging or pre-registering before bot starts)

**Database Layer (`src/db.ts`)**
- SQLite database initialized with WAL mode
- Tables: `events`, `event_reminders_sent`, `rsvps`, `prompts`, `prompt_usage`
- Exports TypeScript interfaces for all row types (EventRow, RsvpRow, PromptRow)
- All DB queries use bun:sqlite's query builder with typed generics — avoid raw SQL

**Configuration (`src/config.ts`)**
- Centralized config object populated from environment variables (see `.env.example`)
- All behavioral knobs live here: reminder timings, display settings, role-based permissions, RSVP emoji, cleanup intervals, Quiplash repeat-avoidance
- Parsing helpers: `required()`, `optional()`, `int()`, `intList()`, `roleList()`, `bool()`

**Reminders (`src/reminders.ts`)**
- Polls for events approaching within configured lead times (e.g., 1440 min / 60 min / 15 min before)
- Tracks sent reminders per event per lead time in `event_reminders_sent` table to avoid duplicates
- Mentions all attendees with "yes" or "maybe" RSVP

**Interactions (`src/interactions/rsvp.ts`)**
- Handles RSVP button clicks (yes/maybe/no) — updates `rsvps` table, edits embed to show counts
- Handles modal submission from advanced RSVP (arrival time, departure time, note)

**Utilities**
- `src/eventView.ts`: builds Discord embeds (`buildEventEmbed()`) and components (`buildEventComponents()`) for event messages
- `src/formatting.ts`: Discord timestamp formatting with relative/absolute modes
- `src/permissions.ts`: role-based access checks

## Data Flow

1. User types slash command in Discord
2. `Events.InteractionCreate` fires in `index.ts`
3. Command name looked up in `commands` map, `execute()` called
4. Command reads/writes `db` (events, rsvps, prompts tables)
5. Command builds Discord embed/components via `eventView.ts` and responds to interaction
6. For events: message posted to channel, `messageId` stored in `events` table for later updates
7. Button/modal interactions route to `interactions/rsvp.ts`, which edits the message in place

Reminder loop runs independently: every `REMINDER_POLL_INTERVAL_MS`, scans for events due within upcoming windows, sends channel messages.

## Configuration & Environment Variables

All knobs in `.env` (see `.env.example`):
- **Discord**: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (optional, for fast propagation)
- **Database**: `DATABASE_PATH` (defaults to `./data/bot.sqlite`)
- **Events**: reminder timings, timezone, locale, RSVP emoji, role-based permissions, cleanup interval, advanced RSVP toggle
- **Quiplash**: default category, random draw limits, manager roles, repeat-avoidance cooldown
- **Cats**: `CAT_MEDIA_DIR`, `CAT_DEFAULT_NAME`, `CAT_MAX_UPLOAD_BYTES`
- Config object in `src/config.ts` is the single source of truth; it has no defaults beyond fallbacks in the parsing helpers

## Common Patterns

**Role-based Access**: Use `hasManagerRole(interaction, config.events.managerRoleIds)` or `config.quiplash.managerRoleIds`. If role list is empty, anyone can act.

**Timestamps**: Store milliseconds since epoch in DB (JavaScript native). Format for Discord with `discordTimestamp(ms, "f" | "R")` — "f" for absolute, "R" for relative ("in 2 hours").

**DB Queries**: Use bun:sqlite's typed query builder:
```typescript
db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(eventId)
db.query<RsvpRow, [number]>("SELECT * FROM rsvps WHERE eventId = ?").all(eventId)
```

**Ephemeral Replies**: Use `MessageFlags.Ephemeral` for command errors/confirmations only visible to the user.

## Database Schema

- **events**: id, guildId, channelId, messageId, name, description, startTime, creatorId, createdAt, cancelled
- **event_reminders_sent**: eventId, minutesBefore (tracks which reminders have fired to avoid duplicates)
- **rsvps**: eventId, userId, status (yes/maybe/no), arrival, departure, note, updatedAt
- **prompts**: id, guildId, category, text, addedBy, createdAt
- **prompt_usage**: promptId, usedAt (tracks when each prompt was drawn for cooldown logic)

All timestamps are milliseconds since epoch. Foreign keys are not enforced (bun:sqlite doesn't enable them by default).
