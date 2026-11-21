import { findCli } from "./paths";
import { runCli, TEXT_CAP } from "./run";

export const DOCTOR_TIMEOUT_MS = 60_000;

export type DoctorSummary = {
  ok: number;
  warn: number;
  fail: number;
  problems: string[];
  text: string;
};

/** Compact, model-facing view of doctor output; the full text stays in the UI. */
export function summarizeDoctor(text: string): DoctorSummary {
  const lines = text.split(/\r?\n/);
  let ok = 0;
  let warn = 0;
  let fail = 0;
  const problems: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[OK]")) ok += 1;
    else if (line.startsWith("[!]")) {
      warn += 1;
      problems.push(line.slice(3).trim());
    } else if (line.startsWith("[X]")) {
      fail += 1;
      problems.push(line.slice(3).trim());
    }
  }
  return { ok, warn, fail, problems: problems.slice(0, 20), text: text.slice(0, TEXT_CAP) };
}

export async function runDoctor(): Promise<DoctorSummary> {
  const cli = findCli();
  if (!cli.doctor) {
    return {
      ok: 0,
      warn: 0,
      fail: 1,
      problems: ["openhop-doctor not found. Install openhop (openhop.cfd) or add it to PATH."],
      text: "",
    };
  }
  const res = await runCli(cli.doctor, [], DOCTOR_TIMEOUT_MS);
  const summary = summarizeDoctor(res.out);
  if (res.timedOut) summary.problems.push("doctor timed out");
  return summary;
}
