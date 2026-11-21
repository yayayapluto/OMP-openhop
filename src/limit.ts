import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { hopText, runHop, type HopReport } from "./hop";

/** Providers whose upstream is opencode.ai. Other providers keep their limits. */
export const OPENCODE_PROVIDERS: Record<string, true> = {
  "opencode-free": true,
  bansos: true,
  bansosr: true,
};

/** One hop per limit burst; retry chains emit several failures per turn. */
export const LIMIT_HOP_COOLDOWN_MS = 120_000;

const LIMIT_TEXT = [
  /free\s+usage\s+limit/i,
  /freeusage_limit/i,
  /x-opencode-gate:\s*ip-(?:throttled|abuse)/i,
  /ip[- ]abuse|abusive traffic|abuse of traffic/i,
  /opencode(?:'s)?\s+free\s+tier/i,
  /rate\s*limit/i,
];

export type LimitMessage = {
  role?: string;
  provider?: string;
  errorStatus?: number;
  errorMessage?: string;
  errorClassificationMessage?: string;
};

/** True for OpenCode provider errors that can be retried on a fresh IP. */
export function isOpencodeLimitError(message: LimitMessage | undefined | null): boolean {
  if (!message || message.role !== "assistant") return false;
  if (!OPENCODE_PROVIDERS[String(message.provider ?? "").toLowerCase()]) return false;
  const text = `${message.errorMessage ?? ""} ${message.errorClassificationMessage ?? ""}`;
  if (message.errorStatus === 429) return true;
  return LIMIT_TEXT.some((pattern) => pattern.test(text));
}
/** Attach passive hop-on-limit. Fake hop injection keeps this testable. */
export function attachLimitHop(pi: ExtensionAPI, hop: () => Promise<HopReport> = runHop): void {
  let lastHopAt = -Infinity;
  pi.on("message_end", async (event, ctx) => {
    const message = event.message as LimitMessage;
    if (!isOpencodeLimitError(message)) return;
    const now = Date.now();
    if (now - lastHopAt < LIMIT_HOP_COOLDOWN_MS) return;
    lastHopAt = now;
    const report = await hop();
    if (report.ok && message.provider && message.model) {
      const target = ctx.models.resolve(`${message.provider}/${message.model}`);
      if (target) await ctx.setModel(target);
    }
    ctx.ui.notify(`openhop: ${hopText(report)}`, report.ok ? "info" : "warning");
  });
}


