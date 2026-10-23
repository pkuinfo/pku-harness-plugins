/**
 * Structured logging. The server is a blind relay: log lines carry route patterns (never
 * concrete paths, which may hold store keys), status codes, timings and fixed event names —
 * never request bodies, frames, envelopes, tokens or query strings.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

/** One JSON object per line on stdout/stderr. */
export function consoleLogger(minLevel: LogLevel = 'info'): Logger {
  const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  return {
    log(level, event, fields) {
      if (order[level] < order[minLevel]) return;
      const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
      if (level === 'error' || level === 'warn') console.error(line);
      else console.log(line);
    },
  };
}

/** Collects lines in memory (tests). */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log(level, event, fields) {
      lines.push(JSON.stringify({ level, event, ...fields }));
    },
  };
}
