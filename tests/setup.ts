// Preloaded before every test file (see bunfig.toml). Populates the env vars
// that src/config.ts requires so importing config/db in tests doesn't throw,
// and points the database at an in-memory instance so tests never touch
// real data on disk.
// Force these even when a real .env is loaded (bun loads .env before this
// preload script runs, so plain ??= would silently keep real values and
// point tests at real data / real Discord role IDs).
process.env.DISCORD_TOKEN = "test-token";
process.env.CLIENT_ID = "test-client-id";
process.env.DATABASE_PATH = ":memory:";
process.env.QUIPLASH_MANAGER_ROLE_IDS = "manager-role";
process.env.EVENT_MANAGER_ROLE_IDS = "manager-role";
process.env.UPDATE_MANAGER_ROLE_IDS = "manager-role";
process.env.ADMIN_USER_IDS = "";
