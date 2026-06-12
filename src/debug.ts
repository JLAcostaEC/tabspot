import type { DebugLevel, TabspotLogSink } from "./types.ts";

const PREFIX = "[tabspot]";

export interface Logger {
  level: DebugLevel | undefined;
  basic(...args: unknown[]): void;
  full(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(level?: DebugLevel, sink?: TabspotLogSink): Logger {
  const emit = (lvl: "basic" | "full" | "warn" | "error", args: unknown[]) => {
    if (sink) {
      sink(lvl, args);
      return;
    }
    if (lvl === "warn") console.warn(PREFIX, ...args);
    else if (lvl === "error") console.error(PREFIX, ...args);
    else console.log(PREFIX, ...args);
  };
  const logger: Logger = {
    level,
    basic(...args) {
      if (logger.level === "basic" || logger.level === "full") emit("basic", args);
    },
    full(...args) {
      if (logger.level === "full") emit("full", args);
    },
    warn(...args) {
      emit("warn", args);
    },
    error(...args) {
      emit("error", args);
    },
  };
  return logger;
}
