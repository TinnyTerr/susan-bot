import { Client, GatewayIntentBits } from "discord.js";
import { CleanupManager } from "./managers/CleanupManager";
import { CommandManager } from "./managers/CommandManager";
import { EventManager } from "./managers/EventManager";
import { InteractionManager } from "./managers/InteractionManager";
import { LogManager } from "./managers/LogManager";
import { UpdateManager } from "./managers/UpdateManager";
import { config } from "./config";
import { ManagerRegistry } from "./core/ManagerRegistry";

// This process is a single shard, spawned and supervised by the shard
// manager (src/index.ts). SHARD_ID/SHARD_COUNT are set by the manager even
// when there's only one shard, so restarts always go through it instead of
// this process respawning itself (see scheduleRestart in update.ts).
const shardId = Number(process.env.SHARD_ID ?? 0);
const shardCount = Number(process.env.SHARD_COUNT ?? 1);

export class Bot {
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds],
    shards: [shardId],
    shardCount,
  });
  readonly registry = new ManagerRegistry();

  async start(): Promise<void> {
    const { client, registry } = this;

    registry.register(new LogManager(client, registry));
    registry.register(new CommandManager(client, registry));
    registry.register(new InteractionManager(client, registry));
    registry.register(new EventManager(client, registry));
    registry.register(new CleanupManager(client, registry));
    registry.register(new UpdateManager(client, registry));

    await registry.initAll();

    client.once("clientReady", () => void registry.readyAll());

    await client.login(config.discordToken);
  }

  async stop(): Promise<void> {
    await this.registry.stopAll();
    await this.client.destroy();
  }
}
