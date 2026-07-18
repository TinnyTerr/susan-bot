# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hangout Bot** is a Discord bot for scheduling events with RSVPs and managing Quiplash-style game prompts. Built with Bun + TypeScript using discord.js and bun:sqlite (local SQLite storage, no external database).

Built as a tribute to Susan, the owner's late cat.

Four main commands:
- **`/event`**: create/list/info/cancel events with two-tier RSVP system (basic Go/Maybe/No, or advanced with arrival/departure times and notes); `resend` (event managers only) reposts an event's embed as a new pinned message, strips buttons from and unpins the old one (so only the new message is live), useful when the pinned embed gets buried or lost
- **`/quiplash`**: add/import/list/remove game prompts by category, draw random prompts with repeat-avoidance via cooldown tracking; `latest` (quiplash managers only) posts/refreshes a pinned "latest prompts" board that's automatically re-edited whenever prompts are added, imported, or removed, and includes a "Top Contributors" leaderboard (by total prompts added, across all categories regardless of the board's own category filter) plus an "Add Prompt" button that opens a modal (prompt text + optional category) so prompts can be added without typing the slash command — see `quiplashView.ts` and `interactions/quiplash.ts`
- **`/cat`**: `show` (default-style usage) posts a random photo/video from a per-cat media folder (`CAT_MEDIA_DIR/<name>/`); defaults to `CAT_DEFAULT_NAME` (susan), `name:any` picks a random cat. Media can be local files or links: `add url:<link> name:<cat>` validates the URL (http(s), direct image/video extension, not a private/loopback host) and checks it's reachable, then appends it to `CAT_MEDIA_DIR/<name>/links.txt` (creating the cat folder if new) — links are posted directly as message content (Discord auto-embeds them) rather than downloaded. No database — reads the filesystem on each call.
- **`/git`**: `status` shows the current commit and whether origin has new commits; `update` (role-gated) pulls, reinstalls deps, and restarts the bot process (guarded against overlapping runs — see "Auto-update" below); `log`/`search`/`show` browse the commit history — paginated embeds with Prev/Next buttons (`gitlog:<mode>:<page>:<query>` custom IDs, handled in `interactions/git.ts`), `search` filters by commit message, `show <hash>` displays a single commit's message and changed files; `tree` renders the repo's file/directory structure at a given ref (defaults to `HEAD`) as an indented tree, via `git.getFileTree()` — the ref is validated against a strict pattern and confirmed to resolve with `rev-parse --verify` before being passed to `ls-tree`, since it comes straight from user input. All read-only subcommands reply ephemerally, and commit text is always rendered inside code blocks / with `allowedMentions: { parse: [] }` since commit messages are attacker-influenceable free text. See `gitView.ts` for embed building.

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

**Shard Manager + Shard split (`src/index.ts`, `src/bot.ts`)**

`bun run dev`/`bun run start` run `src/index.ts`, which is a supervisor, not the Discord client. It spawns one child process per shard from `src/bot.ts` (count from `SHARD_COUNT`, default 1) via `Bun.spawn` with IPC enabled, and keeps them alive:
- On a clean exit requested by the shard itself (`process.send({ type: "restart" })`, used by `/git update` and auto-update — see `scheduleRestart()` in `src/update.ts`), the manager spawns a fresh shard process immediately.
- On an unexpected crash, the manager respawns after a short delay, with a crash-loop guard (gives up after 5 crashes within 60s).
- The manager itself is never replaced or restarted — this is why updates no longer leave an orphaned background process: only the shard child is killed and respawned, the supervisor watching it stays up the whole time.

**Shard (`src/bot.ts`)**
- Initializes the Discord client for its shard (`SHARD_ID`/`SHARD_COUNT` env vars set by the manager) with guild intents
- Routes interactions: slash commands → `commands/` map, buttons/modals → `interactions/rsvp.ts`
- Starts the DB cleanup loop and auto-update loop on ready; hands the ready client to `discordLogger.ts` so update/error logs can be posted to Discord
- On `SIGTERM` (sent by the manager on shutdown or restart), destroys the client and exits cleanly

**Command System**
- `src/commands/event.ts`, `src/commands/quiplash.ts`, `src/commands/cat.ts`, and `src/commands/git.ts` export `data` (SlashCommandBuilder) and `execute(interaction)`; `cat.ts` also exports `autocomplete(interaction)` for cat-name suggestions (routed in `bot.ts`)
- `src/registerCommands.ts` syncs commands to Discord on startup (fetches live commands, removes stale ones, creates/updates as needed)
- `src/deploy-commands.ts` does the same sync standalone (useful for debugging or pre-registering before bot starts)

**Git Auto-Update (`src/git.ts`, `src/update.ts`, `src/autoUpdate.ts`, `src/commands/git.ts`)**
- `git.ts`: thin wrappers around `git` CLI calls (`fetch`, `rev-parse`, `log`, `status --porcelain`, `pull --ff-only`) via `Bun.spawnSync`
- `update.ts`: `checkForUpdates()` fetches + diffs local vs. `origin/<branch>`; `applyUpdate()` pulls (refuses if the working tree is dirty) and runs `bun install` if `AUTO_UPDATE_INSTALL_DEPS`; `scheduleRestart()` sends `{ type: "restart" }` over IPC to the shard manager (`src/index.ts`, our parent process) and exits — the manager spawns the replacement, so this works regardless of how the bot was started (`bun run start`, `bun run dev`, a process manager)
- `autoUpdate.ts`: `startAutoUpdateLoop()` polls on `AUTO_UPDATE_POLL_INTERVAL_MS` when `AUTO_UPDATE_ENABLED=true` and applies+restarts automatically
- `commands/git.ts`: `/git status` (anyone) and `/git update` (gated by `UPDATE_MANAGER_ROLE_IDS`)
- Requires the deployment to be a git checkout with an `origin` remote

**Logging (`src/logger.ts`, `src/discordLogger.ts`)**
- `logger.ts`: single pino instance, level/pretty-print controlled by `LOG_LEVEL`/`LOG_PRETTY`; used throughout instead of `console.*`
- `discordLogger.ts`: `setLoggerClient()` (called once on ready) + `logToDiscordChannel(level, message)` mirrors git pulls, updates, and errors to `LOG_CHANNEL_ID` if set; no-op otherwise

**Database Layer (`src/db.ts`)**
- SQLite database initialized with WAL mode
- Tables: `events`, `rsvps`, `prompts`, `prompt_usage`
- Exports TypeScript interfaces for all row types (EventRow, RsvpRow, PromptRow)
- All DB queries use bun:sqlite's query builder with typed generics — avoid raw SQL

**Configuration (`src/config.ts`)**
- Centralized config object populated from environment variables (see `.env.example`)
- All behavioral knobs live here: display settings, role-based permissions, RSVP emoji, cleanup intervals, Quiplash repeat-avoidance
- Parsing helpers: `required()`, `optional()`, `int()`, `roleList()`, `bool()`

**Cleanup (`src/cleanup.ts`)**
- `startCleanupLoop()` polls on `EVENT_CLEANUP_POLL_INTERVAL_MS` and deletes events (and their rsvps) whose `startTime` is older than `EVENT_CLEANUP_HOURS`; disabled when `EVENT_CLEANUP_HOURS` is 0

**Interactions (`src/interactions/rsvp.ts`)**
- Handles RSVP button clicks (yes/maybe/no) — updates `rsvps` table, edits embed to show counts
- Handles modal submission from advanced RSVP (arrival time, departure time, note)

**Utilities**
- `src/eventView.ts`: builds Discord embeds (`buildEventEmbed()`) and components (`buildEventComponents()`) for event messages
- `src/quiplashView.ts`: builds the "latest prompts" board embed (`buildLatestPromptsEmbed()`) and re-edits every stored board message for a guild/category (`refreshQuiplashBoards()`), backed by the `quiplash_boards` table (one row per pinned board, `category = NULL` means "all categories")
- `src/formatting.ts`: Discord timestamp formatting with relative/absolute modes
- `src/permissions.ts`: role-based access checks, plus `isAdmin()` for the bot-wide `ADMIN_USER_IDS` bypass

## Data Flow

1. User types slash command in Discord
2. `Events.InteractionCreate` fires in `bot.ts`
3. Command name looked up in `commands` map, `execute()` called
4. Command reads/writes `db` (events, rsvps, prompts tables)
5. Command builds Discord embed/components via `eventView.ts` and responds to interaction
6. For events: message posted to channel, `messageId` stored in `events` table for later updates; a discussion thread is started on that message and its `threadId` stored too, since the channel is expected to be read-only outside of threads
7. Button/modal interactions route to `interactions/rsvp.ts`, which edits the message in place

Cleanup loop runs independently: every `EVENT_CLEANUP_POLL_INTERVAL_MS`, deletes events (and rsvps) older than `EVENT_CLEANUP_HOURS`.

## Configuration & Environment Variables

All knobs in `.env` (see `.env.example`):
- **Discord**: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (optional, for fast propagation)
- **Database**: `DATABASE_PATH` (defaults to `./data/bot.sqlite`)
- **Admin**: `ADMIN_USER_IDS` (comma-separated Discord user IDs) bypass every manager-role check bot-wide (events, quiplash, `/git update`)
- **Events**: timezone, locale, RSVP emoji, role-based permissions, cleanup interval, advanced RSVP toggle
- **Quiplash**: default category, random draw limits, manager roles, repeat-avoidance cooldown
- **Cats**: `CAT_MEDIA_DIR`, `CAT_DEFAULT_NAME`, `CAT_MAX_UPLOAD_BYTES`
- **Auto-update**: `UPDATE_MANAGER_ROLE_IDS`, `AUTO_UPDATE_ENABLED`, `AUTO_UPDATE_POLL_INTERVAL_MS`, `AUTO_UPDATE_INSTALL_DEPS`
- **Logging**: `LOG_LEVEL`, `LOG_PRETTY`, `LOG_CHANNEL_ID`
- Config object in `src/config.ts` is the single source of truth; it has no defaults beyond fallbacks in the parsing helpers

## Common Patterns

**Role-based Access**: Use `hasManagerRole(interaction, config.events.managerRoleIds)` or `config.quiplash.managerRoleIds`. If role list is empty, anyone can act. `hasManagerRole` always allows users whose ID is in `config.adminUserIds` (see `isAdmin()` in `src/permissions.ts`), regardless of role list.

**Timestamps**: Store milliseconds since epoch in DB (JavaScript native). Format for Discord with `discordTimestamp(ms, "f" | "R")` — "f" for absolute, "R" for relative ("in 2 hours").

**DB Queries**: Use bun:sqlite's typed query builder:
```typescript
db.query<EventRow, [number]>("SELECT * FROM events WHERE id = ?").get(eventId)
db.query<RsvpRow, [number]>("SELECT * FROM rsvps WHERE eventId = ?").all(eventId)
```

**Ephemeral Replies**: Use `MessageFlags.Ephemeral` for command errors/confirmations only visible to the user.

## Database Schema

- **events**: id, guildId, channelId, messageId, threadId, name, description, startTime, creatorId, createdAt, cancelled
- **rsvps**: eventId, userId, status (yes/maybe/no), arrival, departure, note, updatedAt
- **prompts**: id, guildId, category, text, addedBy, createdAt
- **prompt_usage**: promptId, usedAt (tracks when each prompt was drawn for cooldown logic)
- **quiplash_boards**: id, guildId, channelId, messageId, category (nullable — NULL means "all categories"), createdAt (tracks pinned `/quiplash latest` boards so they can be re-edited on every add/import/remove)

All timestamps are milliseconds since epoch. Foreign keys are not enforced (bun:sqlite doesn't enable them by default).
