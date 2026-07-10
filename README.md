# Hangout Bot

A Discord bot (Bun + TypeScript) for scheduling hangouts/events with RSVPs and reminders,
plus a Quiplash-style prompt manager for party games and a `/cat` command that posts
photos and videos of our cats. Built in memory of Susan. Storage is a local SQLite file
(via `bun:sqlite`) — no external database required.

## Setup

1. Create a Discord application + bot at https://discord.com/developers/applications,
   copy its **token** and **application (client) ID**, and invite it to your server with
   the `applications.commands` and `bot` scopes (permissions: Send Messages, Embed Links,
   Read Message History).
2. `bun install`
3. `cp .env.example .env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, and (recommended for
   development) `GUILD_ID` so commands register instantly instead of waiting ~1 hour for
   global propagation.
4. `bun run start` (or `bun run dev` to auto-restart on changes). On every startup the
   bot overwrites its registered slash commands with the current `/event`, `/quiplash`,
   and `/cat` definitions — anything stale (renamed/removed commands from an older
   version of the bot) is deleted automatically, no manual step needed.

   You can also run this sync standalone with `bun run deploy-commands` (useful if you
   want commands to appear before starting the bot process, e.g. with a guild ID for
   instant propagation).

## Configuration

Every behavioral knob lives in `.env` (see `.env.example` for the full list with
descriptions) and is centralized in `src/config.ts`. Highlights:

- **Reminders**: `REMINDER_MINUTES_BEFORE` (multiple comma-separated lead times, e.g.
  `1440,60,15`), `REMINDER_POLL_INTERVAL_MS`.
- **Display**: `TIMEZONE`, `LOCALE`, `EVENT_LIST_MAX`.
- **Permissions**: `EVENT_MANAGER_ROLE_IDS` / `QUIPLASH_MANAGER_ROLE_IDS` restrict who can
  create/cancel events or add/remove prompts (empty = anyone).
- **RSVP**: `RSVP_EMOJI_YES/MAYBE/NO` (optional, blank = plain text labels),
  `EVENT_ADVANCED_RSVP_ENABLED` toggles the "Arrival / Departure" details button.
- **Cats**: `CAT_MEDIA_DIR` (folder of per-cat subfolders), `CAT_DEFAULT_NAME` (the cat
  `/cat` posts when no name is given — Susan by default), `CAT_MAX_UPLOAD_BYTES`.
- **Cleanup**: `EVENT_CLEANUP_HOURS` auto-removes old events (0 disables).
- **Quiplash**: default/max random draw counts, default category, and repeat-avoidance
  (`QUIPLASH_AVOID_REPEATS` + `QUIPLASH_COOLDOWN_HOURS`) so the same prompt doesn't show
  up again right away.

## Commands

### `/event`
- `create name when [description] [channel]` — natural-language time parsing (e.g. "next
  Friday 7pm", "2026-08-01 19:00"). Posts an embed with RSVP buttons.
- `list` — upcoming events.
- `info id` — details for one event.
- `cancel id` — marks an event cancelled and updates its message.

**RSVPs** have two tiers:
- **Basic**: Going / Maybe / Can't go buttons.
- **Advanced**: an "Arrival / Departure" button opens a form to specify what time you can
  get there, when you need to leave, and a free-text note (bringing food, +1, etc.). Can
  be disabled via `EVENT_ADVANCED_RSVP_ENABLED=false`.

### `/quiplash`
- `add prompt [category]` — add one prompt.
- `import prompts [category]` — bulk add, one prompt per line (or `;`-separated).
- `random [count] [category]` — draw prompts for a game session.
- `list [category]` — list stored prompts.
- `remove id` — delete a prompt.
- `categories` — list categories in use with counts.

### `/cat`
- `[name]` — posts a random photo or video of the named cat (autocompletes from the
  folders in `CAT_MEDIA_DIR`). With no name it posts the default cat (`CAT_DEFAULT_NAME`,
  Susan out of the box); pass `any` to draw from all cats.

To add a cat, create a folder named after them under `CAT_MEDIA_DIR` (default
`./media/cats/`) and drop in their photos/videos — e.g. `./media/cats/susan/porch.jpg`.
Supported formats: jpg, jpeg, png, gif, webp, mp4, mov, webm. Files over the upload
limit are skipped.
