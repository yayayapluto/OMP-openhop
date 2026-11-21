import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";
import { stateDir } from "./paths";

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|api[-_]?key|credential/i;
const CONTENT_KEY = /payload|prompt|profile|message|messages|output|response|body|headers|text|content|completion|reasoning/i;
const SENSITIVE_TEXT = /\b(token|secret|password|authorization|cookie|api[-_]?key|credential)\s*[:=]\s*[^\s,;]+/gi;
const URL_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s]*/gi;
const STRING_LIMIT = 200;
const RESERVED_KEYS = ["ts", "level", "event", "plugin", "version"] as const;
const ACTION_WHITELIST: Record<string, true> = {
  status: true,
  hop: true,
  doctor: true,
};

export type LogLevel = "info" | "warn" | "error";
export function safeAction(value: unknown, fallback = "unknown"): string {
  const action = String(value ?? "").trim().toLowerCase();
  return ACTION_WHITELIST[action] ? action : fallback;
}

function cleanString(value: string): string {
  const withoutQuery = value.replace(URL_QUERY, "$1");
  const masked = withoutQuery.replace(SENSITIVE_TEXT, "$1=[redacted]");
  return masked.length > STRING_LIMIT ? masked.slice(0, STRING_LIMIT) : masked;
}

export function redactMetadata(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key) || CONTENT_KEY.test(key) || key.toLowerCase() === "stack") continue;
      out[key] = redactMetadata(nested);
    }
    return out;
  }
  return value;
}

export function pluginLogPath(dir: string = stateDir()): string {
  return join(dir, "plugin.log");
}

export function logEvent(
  level: LogLevel,
  event: string,
  metadata: Record<string, unknown> = {},
  dir: string = stateDir(),
): void {
  if (process.env.OMP_PLUGIN_LOG === "0") return;
  try {
    if (!existsSync(dir)) return;
    const redacted = redactMetadata(metadata) as Record<string, unknown>;
    for (const key of RESERVED_KEYS) delete redacted[key];
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      plugin: "omp-openhop",
      version: packageJson.version,
      ...redacted,
    };
    appendFileSync(pluginLogPath(dir), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Best effort: logging never enters plugin control flow.
  }
}
