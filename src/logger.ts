import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logging.level,
  transport: config.logging.pretty
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
    : undefined,
});
