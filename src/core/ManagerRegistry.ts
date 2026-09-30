import { EventEmitter } from "node:events";
import type { Manager } from "./Manager";

// Shared bus every manager can publish/subscribe to for cross-manager events
// (e.g. WebhookManager emits "webhook:github" and any manager can listen).
export class ManagerRegistry {
  readonly bus = new EventEmitter();
  private managers = new Map<string, Manager>();

  register<T extends Manager>(manager: T): T {
    if (this.managers.has(manager.name)) {
      throw new Error(`Manager "${manager.name}" is already registered`);
    }
    this.managers.set(manager.name, manager);
    return manager;
  }

  get<T extends Manager>(name: string): T {
    const manager = this.managers.get(name);
    if (!manager) throw new Error(`Manager "${name}" is not registered`);
    return manager as T;
  }

  has(name: string): boolean {
    return this.managers.has(name);
  }

  all(): Manager[] {
    return [...this.managers.values()];
  }

  async initAll(): Promise<void> {
    for (const manager of this.managers.values()) await manager.init();
  }

  async readyAll(): Promise<void> {
    for (const manager of this.managers.values()) await manager.ready();
  }

  async stopAll(): Promise<void> {
    for (const manager of [...this.managers.values()].reverse()) await manager.stop();
  }
}
