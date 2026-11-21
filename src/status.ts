import { existsSync } from "node:fs";
import { join } from "node:path";
import { findCli, PLATFORM, PROXY_PORT, stateDir, type CliPaths, type Platform } from "./paths";
import { ageSeconds, portOpen, readJson } from "./run";

export type StatusReport = {
  installed: boolean;
  platform: Platform;
  destDir: string;
  cli: CliPaths;
  proxyPort: number;
  proxyListening: boolean;
  keeperHeartbeatAgo: number | null;
  guardHeartbeatAgo: number | null;
  guard: Record<string, unknown> | null;
  egress: Record<string, unknown> | null;
  paused: boolean;
  probe?: { ok: boolean; ip: string; warp: string; error: string };
};

export async function collectStatus(probe = false): Promise<StatusReport> {
  const dir = stateDir(PLATFORM);
  const cli = findCli(PLATFORM);
  const status: StatusReport = {
    installed: !!cli.hop || !!cli.doctor || existsSync(dir),
    platform: PLATFORM,
    destDir: dir,
    cli,
    proxyPort: PROXY_PORT,
    proxyListening: await portOpen(PROXY_PORT),
    keeperHeartbeatAgo: ageSeconds(join(dir, "keeper", "heartbeat.txt")),
    guardHeartbeatAgo: ageSeconds(join(dir, "guard", "heartbeat.txt")),
    guard: await readJson(join(dir, "guard", "state.json")),
    egress: await readJson(join(dir, "lane", "egress_mode.json")),
    paused: existsSync(join(dir, "keeper.pause")),
  };
  if (!probe) return status;
  try {
    const res = await fetch("https://cloudflare.com/cdn-cgi/trace", {
      proxy: `http://127.0.0.1:${PROXY_PORT}`,
      signal: AbortSignal.timeout(3000),
      headers: { "User-Agent": "omp-openhop" },
    });
    const body = (await res.text()).slice(0, 4096);
    status.probe = {
      ok: res.ok && /^ip=.+$/m.test(body),
      ip: /^ip=(.+)$/m.exec(body)?.[1]?.trim() ?? "",
      warp: /^warp=(.+)$/m.exec(body)?.[1]?.trim() ?? "",
      error: res.ok ? "" : `HTTP ${res.status}`,
    };
  } catch (err) {
    status.probe = {
      ok: false,
      ip: "",
      warp: "",
      error: err instanceof Error ? err.message.slice(0, 160) : "probe failed",
    };
  }
  return status;
}

function humanAge(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function statusText(s: StatusReport): string {
  const lines = [
    `openhop: ${s.installed ? "installed" : "not found"} (${s.destDir})`,
    `proxy 127.0.0.1:${s.proxyPort}: ${s.proxyListening ? "listening" : "closed"}`,
    `keeper heartbeat: ${humanAge(s.keeperHeartbeatAgo)} ago`,
    `guard heartbeat: ${humanAge(s.guardHeartbeatAgo)} ago`,
    `rotation paused: ${s.paused ? "yes" : "no"}`,
  ];
  const mode = s.egress && typeof s.egress.mode === "string" ? s.egress.mode : "";
  if (mode) lines.push(`egress mode: ${mode}`);
  const hops = s.guard && typeof s.guard.day_hops === "number" ? s.guard.day_hops : null;
  if (hops !== null) lines.push(`rotations today: ${hops}`);
  if (s.probe) {
    lines.push(
      s.probe.ok
        ? `probe: ok (ip=${s.probe.ip}${s.probe.warp ? `, warp=${s.probe.warp}` : ""})`
        : `probe: failed (${s.probe.error})`,
    );
  }
  if (!s.proxyListening) {
    lines.push('hint: open the openhop app, or press "Fix everything" so the keeper/proxy runs.');
  }
  return lines.join("\n");
}
