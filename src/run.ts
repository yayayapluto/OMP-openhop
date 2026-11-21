import { readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import { logEvent } from "./log";

export const TEXT_CAP = 200_000;

export type CliResult = { code: number; out: string; timedOut: boolean };

export async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function ageSeconds(path: string): number | null {
  try {
    return Math.max(0, Math.round((Date.now() - statSync(path).mtimeMs) / 1000));
  } catch {
    return null;
  }
}

export function portOpen(port: number, timeoutMs = 600): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const socket = connect({ host: "127.0.0.1", port });
  socket.setTimeout(timeoutMs, () => {
    socket.destroy();
    resolve(false);
  });
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => {
    socket.destroy();
    resolve(false);
  });
  return promise;
}

/** Run an openhop CLI (.cmd through cmd.exe on Windows — Bun cannot exec it directly).
 *  `call` keeps paths with spaces intact; bare quoted paths are rejected by cmd. */
export async function runCli(target: string, args: string[], timeoutMs: number): Promise<CliResult> {
  const isCmd = /\.(cmd|bat)$/i.test(target);
  const cmd = isCmd ? ["cmd.exe", "/d", "/s", "/c", "call", target] : [target];
  const child = Bun.spawn([...cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  clearTimeout(timer);
  logEvent(code === 0 ? "info" : "warn", "cli_exit", { code, timedOut });
  const text = [out, err].filter(Boolean).join("\n").trim();
  return { code, out: text.slice(0, TEXT_CAP), timedOut };
}
