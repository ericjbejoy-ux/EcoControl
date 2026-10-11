/**
 * Structured logging (NFR-8) — pino, with a plain JSON fallback so the
 * ingestion layer can be unit-tested without the pino transport.
 */

import { getIngestionConfig } from './config.js';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  trace(msg: string, ctx?: Record<string, unknown>): void;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  fatal(msg: string, ctx?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: number,
    private readonly bindings: Record<string, unknown> = {}
  ) {}

  private write(level: Level, msg: string, ctx?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const payload = {
      level,
      time: new Date().toISOString(),
      msg,
      ...this.bindings,
      ...(ctx ?? {}),
    };
    const line = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  trace(msg: string, ctx?: Record<string, unknown>) { this.write('trace', msg, ctx); }
  debug(msg: string, ctx?: Record<string, unknown>) { this.write('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.write('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.write('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.write('error', msg, ctx); }
  fatal(msg: string, ctx?: Record<string, unknown>) { this.write('fatal', msg, ctx); }
  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.minLevel, { ...this.bindings, ...bindings });
  }
}

let instance: Logger | null = null;

export function getLogger(): Logger {
  if (!instance) {
    const level = (getIngestionConfig().logLevel as Level) ?? 'info';
    instance = new ConsoleLogger(LEVEL_ORDER[level] ?? LEVEL_ORDER.info);
  }
  return instance;
}

export function setLogger(logger: Logger | null): void {
  instance = logger;
}

/** In-memory logger for tests — records everything, prints nothing. */
export function createMemoryLogger(): Logger & { entries: Array<{ level: Level; msg: string; ctx?: Record<string, unknown> }> } {
  const entries: Array<{ level: Level; msg: string; ctx?: Record<string, unknown> }> = [];
  const make = (bindings: Record<string, unknown> = {}): Logger & { entries: typeof entries } => ({
    entries,
    trace: (msg, ctx) => entries.push({ level: 'trace', msg, ctx }),
    debug: (msg, ctx) => entries.push({ level: 'debug', msg, ctx }),
    info: (msg, ctx) => entries.push({ level: 'info', msg, ctx }),
    warn: (msg, ctx) => entries.push({ level: 'warn', msg, ctx }),
    error: (msg, ctx) => entries.push({ level: 'error', msg, ctx }),
    fatal: (msg, ctx) => entries.push({ level: 'fatal', msg, ctx }),
    child: (b) => make({ ...bindings, ...b }),
  });
  return make();
}
