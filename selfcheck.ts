/** Run: bun run selfcheck (bun selfcheck.ts) — parser + path detection, no openhop install needed. */
import { findCli, openhopCompletions, stateDir, statusText, type StatusReport } from "./src/index";
import { parseHopOutput } from "./src/hop";
import { summarizeDoctor } from "./src/doctor";

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(`FAIL: ${message}`);
}

const winHop = [
  "old /64: 2a09:bac5:1:2::/64",
  "-- rotating (keeper paused) --",
  "new /64: 2a09:bac5:9:8::/64",
  "== FRESH /64 ✓ — re-send your message ==",
].join("\r\n");
const winReport = parseHopOutput(winHop);
assert(winReport.ok, "windows fresh hop parsed as ok");
assert(winReport.oldBlock === "2a09:bac5:1:2::/64", "old block parsed");
assert(winReport.newBlock === "2a09:bac5:9:8::/64", "new block parsed");

const sameBlock = parseHopOutput(
  "old /64: 2a09:bac5:1:2::/64\nnew /64: 2a09:bac5:1:2::/64\n== cloudflare handed back the same block — run me again ==",
);
assert(!sameBlock.ok && !sameBlock.fresh, "same-block hop is not fresh");

const failed = parseHopOutput("-- registration failed — keeper will keep retrying --");
assert(!failed.ok && failed.output.length > 0, "failed hop keeps output");

const doctorText = [
  "  [OK] warp-cli found",
  "  [OK] tunnel connected",
  "  [!]  guard state is stale",
  "  [X]  proxy not listening on 127.0.0.1:41987",
  "  [i]  active egress mode: PROXY",
].join("\n");
const doctor = summarizeDoctor(doctorText);
assert(doctor.ok === 2 && doctor.warn === 1 && doctor.fail === 1, "doctor counters");
assert(doctor.problems[0] === "guard state is stale", "warn line becomes a problem");
assert(doctor.text === doctorText, "doctor keeps full text");

assert(stateDir("win32").length > 0 && stateDir("linux").length > 0, "state dir resolves");
const cli = findCli();
assert(cli.hop === null || typeof cli.hop === "string", "hop path is string or null");

const fake: StatusReport = {
  installed: true,
  platform: "linux",
  destDir: "/tmp/openhop",
  cli: { hop: "/tmp/hop", doctor: null },
  proxyPort: 41987,
  proxyListening: false,
  keeperHeartbeatAgo: 120,
  guardHeartbeatAgo: null,
  guard: { day_hops: 3 },
  egress: { mode: "proxy" },
  paused: false,
};
const text = statusText(fake);
assert(text.includes("closed") && !text.includes("listening"), "status shows closed proxy");
assert(text.includes("rotations today: 3"), "status includes rotations");
assert(text.includes("Fix everything"), "closed proxy adds hint");

const all = openhopCompletions("");
assert(all.length === 3, "all three actions offered when the argument is empty");
assert(all[0].value === "status" && all[2].value === "doctor", "completion order");
const hopOnly = openhopCompletions("h");
assert(hopOnly.length === 1 && hopOnly[0].value === "hop", "prefix filters to hop");
assert(openhopCompletions("zzz").length === 0, "unknown prefix yields no items");

console.log("selfcheck: 16 assertions passed");
