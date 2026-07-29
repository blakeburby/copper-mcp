/**
 * Minimal structured logger. ALL output goes to stderr — stdout is reserved for
 * the MCP protocol channel. Log lines are sanitized to avoid leaking secrets
 * (cookies, tokens, passwords, auth headers).
 */
import { loadConfig, type LogLevel } from "../config.js";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** Redact obviously-sensitive substrings before anything is written. */
export function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(cookie|set-cookie|authorization|x-pw-accesstoken)\s*[:=]\s*[^;]+/gi, "$1=[REDACTED]")
      .replace(/(password|passwd|token|secret|api[_-]?key)"?\s*[:=]\s*"?[^\s",}]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(cookie|cookies|token|password|secret|apikey|api_key|authorization|storagestate|storage_state)$/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

function enabled(level: LogLevel): boolean {
  const configured = loadConfig().logLevel;
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[configured];
}

function emit(level: LogLevel, opId: string | undefined, msg: string, meta?: unknown): void {
  if (!enabled(level)) return;
  const prefix = opId ? `[${level}][op:${opId}]` : `[${level}]`;
  if (meta !== undefined) {
    console.error(`${prefix} ${msg}`, JSON.stringify(sanitize(meta)));
  } else {
    console.error(`${prefix} ${msg}`);
  }
}

export interface Logger {
  error(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
  /** The operation id this logger tags every line with. */
  readonly opId: string;
}

/** Create a short, unique operation id for correlating a tool call's logs. */
export function newOperationId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

/** A logger bound to a single operation id. */
export function createLogger(opId: string = newOperationId()): Logger {
  return {
    opId,
    error: (msg, meta) => emit("error", opId, msg, meta),
    warn: (msg, meta) => emit("warn", opId, msg, meta),
    info: (msg, meta) => emit("info", opId, msg, meta),
    debug: (msg, meta) => emit("debug", opId, msg, meta),
  };
}

/** Process-level logger with no operation id, for bootstrap/shutdown lines. */
export const rootLogger: Logger = {
  opId: "root",
  error: (msg, meta) => emit("error", undefined, msg, meta),
  warn: (msg, meta) => emit("warn", undefined, msg, meta),
  info: (msg, meta) => emit("info", undefined, msg, meta),
  debug: (msg, meta) => emit("debug", undefined, msg, meta),
};
