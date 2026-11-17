import { env } from "../env.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

function write(level: Level, scope: string, message: string, detail?: unknown) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString().slice(11, 19);
  const line = `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (detail === undefined) sink(line);
  else sink(line, detail instanceof Error ? (detail.stack ?? detail.message) : detail);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, detail?: unknown) => write("debug", scope, message, detail),
    info: (message: string, detail?: unknown) => write("info", scope, message, detail),
    warn: (message: string, detail?: unknown) => write("warn", scope, message, detail),
    error: (message: string, detail?: unknown) => write("error", scope, message, detail),
  };
}

export type Logger = ReturnType<typeof createLogger>;
