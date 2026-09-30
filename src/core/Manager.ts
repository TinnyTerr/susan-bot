import { EventEmitter } from "node:events";
import type { Client } from "discord.js";
import type { Logger } from "pino";
import { logger } from "../logger";
import type { ManagerRegistry } from "./ManagerRegistry";

export abstract class Manager extends EventEmitter {
  protected log: Logger;

  constructor(readonly name: string, protected client: Client, protected registry: ManagerRegistry) {
    super();
    this.log = logger.child({ manager: name });
  }

  // Called once all managers are registered, before login. Override to set up state.
  async init(): Promise<void> {}

  // Called after the discord.js client has fired 'ready'. Override for things that need a live client.
  async ready(): Promise<void> {}

  // Called on shutdown. Override to clear timers / close handles.
  async stop(): Promise<void> {}
}
