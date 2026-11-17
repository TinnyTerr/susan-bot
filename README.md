# Hangout Bot

A Discord bot (Bun + TypeScript) for scheduling hangouts/events with RSVPs,
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
- **Auto-update**: `UPDATE_MANAGER_ROLE_IDS` restricts who can run `/git update`.
  `AUTO_UPDATE_ENABLED` turns on periodic background checks (`AUTO_UPDATE_POLL_INTERVAL_MS`)
  that pull and restart automatically when new commits land on origin.
- **Logging**: `LOG_LEVEL` / `LOG_PRETTY` control the [pino](https://getpino.io) console
  logger. `LOG_CHANNEL_ID` additionally mirrors git pulls, updates, and errors to a
  Discord channel (blank = console only).

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

#### Upload site
`bun run web` serves a page for uploading cat photos/videos. Uploaders log in with
Discord (`identify` scope, members of `GUILD_ID` only). Files are stored on the files
server under one account (`CAT_FILES_API_KEY`), and the file's raw link is appended to
`CAT_MEDIA_DIR/<cat>/links.txt` with the name the uploader gave it and their Discord
id. `/cat show` then posts it as `<name> from @uploader` (no ping).

Moderation:
- Uploads from unknown users wait for review. They're posted to `CAT_REVIEW_CHANNEL_ID`
  with **Approve**, **Approve with rename** (modal to change name and/or cat),
  **Approve + trust user** and **Deny** buttons. `/cat review` shows the oldest five.
  Denied files are deleted from the files server.
- `/cat allow @user`: their uploads skip review. `/cat deny @user`: blocked from the
  site, and their sessions end. `/cat reset @user`: back to review. `/cat uploaders`
  lists both.
- All of the above need `CAT_MANAGER_ROLE_IDS` (blank = `ADMIN_USER_IDS` only).

Setup:
1. Developer portal → this bot's application → OAuth2: add `<WEB_PUBLIC_URL>/callback`
   as a redirect and copy the client secret into `DISCORD_CLIENT_SECRET`.
2. Make an API key on the files server for the storage account → `CAT_FILES_API_KEY`.
3. Set `WEB_PUBLIC_URL`, `CAT_REVIEW_CHANNEL_ID`, `CAT_MANAGER_ROLE_IDS`, then
   `bun run web` (listens on `WEB_HOST:WEB_PORT`, default `127.0.0.1:3080`).

Sessions are in memory, so restarting the site logs everyone out. `links.txt` lines are
`url[<TAB>name[<TAB>uploaderId]]`, so old files of bare URLs still work.

### `/git`
- `status` — shows the current commit, whether origin has new commits, and whether the
  working tree has uncommitted local changes. Ephemeral, anyone can run it.
- `update` — pulls the latest code (fast-forward only), runs `bun install` if
  dependencies changed, then restarts the bot process. Restricted to
  `UPDATE_MANAGER_ROLE_IDS` if set. Refuses to run if the working tree has uncommitted
  local changes.

Requires the bot to run from a git checkout with an `origin` remote. Set
`AUTO_UPDATE_ENABLED=true` to have the bot check origin on a timer and apply updates
automatically without anyone running `/git update` — see `.env.example` for the related
`AUTO_UPDATE_*` variables. Either path restarts the bot by spawning a replacement process
and exiting, so it works whether you started it with `bun run start`, `bun run dev`, or a
process manager. Pulls, updates, and errors are logged via pino and, if `LOG_CHANNEL_ID`
is set, also posted to that channel.
