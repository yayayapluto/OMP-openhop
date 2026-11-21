import { findCli } from "./paths";
import { runCli } from "./run";
import { logEvent } from "./log";

export const HOP_TIMEOUT_MS = 120_000;

export type HopReport = {
  ok: boolean;
  oldBlock: string;
  newBlock: string;
  fresh: boolean;
  timedOut: boolean;
  output: string;
};

/** Parse what both src/zen_hop.py and scripts/zen-hop.sh print. */
export function parseHopOutput(text: string): HopReport {
  const oldBlock = /old \/64:\s*(\S+)/.exec(text)?.[1] ?? "";
  const newBlock = /new \/64:\s*(\S+)/.exec(text)?.[1] ?? "";
  const fresh = text.includes("FRESH /64") && text.includes("✓");
  return {
    ok: fresh,
    oldBlock: oldBlock === "?" ? "" : oldBlock,
    newBlock: newBlock === "?" ? "" : newBlock,
    fresh,
    timedOut: /timed out/i.test(text),
    output: text,
  };
}

export function hopText(r: HopReport): string {
  if (r.ok) {
    return `Fresh WARP /64: ${r.oldBlock || "?"} → ${r.newBlock || "?"}. Re-send the message or continue.`;
  }
  if (r.timedOut) return "Hop still running after 120s. Check `openhop` status; do not start a second hop.";
  const reason = r.output.split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
  return `Hop failed${reason ? `: ${reason}` : ""}. Try again, or run the openhop app's "Fix everything".`;
}

let hopInFlight: Promise<HopReport> | null = null;

/** Single-flight hop: concurrent callers share one rotation instead of racing keeper. */
export async function runHop(onProgress?: (stage: string) => void): Promise<HopReport> {
  if (hopInFlight) {
    onProgress?.("a hop is already running");
    return hopInFlight;
  }
  const cli = findCli();
  if (!cli.hop) {
    logEvent("warn", "cli_missing", { cli: "hop" });
    return {
      ok: false,
      oldBlock: "",
      newBlock: "",
      fresh: false,
      timedOut: false,
      output: "openhop-hop not found. Install openhop (openhop.cfd) or add it to PATH.",
    };
  }
  hopInFlight = (async () => {
    const startedAt = Date.now();
    logEvent("info", "hop_started", {});
    onProgress?.("rotating WARP /64 (this takes ~10-30s)…");
    try {
      const res = await runCli(cli.hop!, [], HOP_TIMEOUT_MS);
      const report = parseHopOutput(res.out);
      if (res.timedOut) {
        report.ok = false;
        report.timedOut = true;
        report.output = `${report.output}\n(hint: still rotating — run status, or the openhop app)`.trim();
      } else if (res.code !== 0 && !report.output) {
        report.ok = false;
        report.output = `openhop-hop exited with code ${res.code}`;
      }
      logEvent(report.ok ? "info" : "warn", report.ok ? "hop_succeeded" : "hop_failed", {
        durationMs: Date.now() - startedAt,
        ok: report.ok,
        timedOut: report.timedOut,
        code: res.code,
      });
      return report;
    } catch (err) {
      logEvent("error", "hop_failed", {
        durationMs: Date.now() - startedAt,
        ok: false,
        error: err instanceof Error ? err.message : "hop error",
      });
      throw err;
    }
  })();
  try {
    return await hopInFlight;
  } finally {
    hopInFlight = null;
  }
}
