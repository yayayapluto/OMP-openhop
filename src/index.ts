/**
 * omp-openhop — expose the local openhop install to an omp session.
 *
 * openhop itself stays an external program (proxy on 127.0.0.1:41987, WARP,
 * keeper/guard workers). This extension only reads its state files and asks its
 * CLI for actions; it never touches omp's inference path.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { runDoctor } from "./doctor";
import { hopText, runHop } from "./hop";
import { collectStatus, statusText } from "./status";

export { parseHopOutput, runHop } from "./hop";
export { runDoctor, summarizeDoctor } from "./doctor";
export { collectStatus, statusText } from "./status";
export { findCli, stateDir } from "./paths";

export default function openhopExtension(pi: ExtensionAPI) {
  const z = pi.zod;

  pi.setLabel("openhop");

  pi.registerTool({
    name: "openhop",
    label: "openhop",
    description:
      "Inspect or control the local openhop install: status (proxy, keeper/guard heartbeat, egress mode), hop (rotate the WARP exit /64), doctor (diagnostics). Does not touch this session's traffic.",
    parameters: z.object({
      action: z.string().describe("status | hop | doctor"),
      probe: z.boolean().optional().describe("status only: also make one request through the proxy"),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const action = String(params.action || "").toLowerCase();
      if (action === "status") {
        const status = await collectStatus(params.probe === true);
        return {
          content: [{ type: "text", text: statusText(status) }],
          details: status as unknown as Record<string, unknown>,
        };
      }
      if (action === "hop") {
        onUpdate?.({ content: [{ type: "text", text: "rotating WARP /64…" }] });
        const report = await runHop((stage) => onUpdate?.({ content: [{ type: "text", text: stage }] }));
        return {
          content: [{ type: "text", text: hopText(report) }],
          details: report as unknown as Record<string, unknown>,
        };
      }
      if (action === "doctor") {
        const summary = await runDoctor();
        if (summary.text) {
          try {
            if (ctx.hasUI) await ctx.ui.editor("openhop doctor", summary.text);
            else ctx.ui.notify(summary.text.split(/\r?\n/).slice(0, 8).join("\n"), "info");
          } catch {
            /* UI is best-effort; the summary is still returned */
          }
        }
        const head = `doctor: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} failed`;
        return {
          content: [
            {
              type: "text",
              text: summary.problems.length ? `${head}\n- ${summary.problems.join("\n- ")}` : head,
            },
          ],
          details: { ok: summary.ok, warn: summary.warn, fail: summary.fail } as Record<string, unknown>,
        };
      }
      return {
        content: [{ type: "text", text: "Unknown action. Use status, hop or doctor." }],
        isError: true,
      };
    },
  });

  pi.registerCommand("openhop", {
    description: "Control openhop: /openhop status | hop | doctor",
    handler: async (args, ctx) => {
      const action = String(args ?? "").trim().toLowerCase();
      if (action === "" || action === "status") {
        ctx.ui.notify(statusText(await collectStatus(false)), "info");
        return;
      }
      if (action === "hop") {
        const report = await runHop();
        ctx.ui.notify(hopText(report), report.ok ? "info" : "warning");
        return;
      }
      if (action === "doctor") {
        const summary = await runDoctor();
        if (!summary.text) {
          ctx.ui.notify(summary.problems[0] || "doctor produced no output", "warning");
          return;
        }
        try {
          await ctx.ui.editor("openhop doctor", summary.text);
        } catch {
          ctx.ui.notify(summary.text.split(/\r?\n/).slice(0, 8).join("\n"), "info");
        }
        return;
      }
      ctx.ui.notify("Usage: /openhop status | hop | doctor", "warning");
    },
  });
}
