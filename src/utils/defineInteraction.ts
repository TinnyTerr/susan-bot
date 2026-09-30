import type { ComponentHandler } from "../types/interaction";

// Identity helper for button/modal handlers, same idea as defineCommand.
export function defineInteraction(handler: ComponentHandler): ComponentHandler {
  return handler;
}
