import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROXY_PORT = Number(process.env.OUC_SERVICE_PROXY_PORT || 41987);
export const PLATFORM: Platform = process.platform === "win32" ? "win32" : "linux";

export type Platform = "win32" | "linux";

export type CliPaths = {
  hop: string | null;
  doctor: string | null;
};

function firstExisting(candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Where openhop keeps its state. Windows: %LOCALAPPDATA%\openhop. Linux: install.sh's
 *  ~/.local/share/opencode-unlimited, falling back to the newer branded directory. */
export function stateDir(plat: Platform = PLATFORM): string {
  if (plat === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "openhop");
  }
  const base = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const legacy = join(base, "opencode-unlimited");
  return existsSync(legacy) ? legacy : join(base, "openhop");
}

/** Locate the hop/doctor CLIs. Windows ships .cmd wrappers in <state>/bin; Linux
 *  install.sh puts shell scripts in ~/.local/bin. Falls back to PATH lookup. */
export function findCli(plat: Platform = PLATFORM): CliPaths {
  if (plat === "win32") {
    const bin = join(stateDir(plat), "bin");
    return {
      hop: firstExisting([
        join(bin, "openhop-hop.cmd"),
        Bun.which("openhop-hop"),
        Bun.which("openhop-hop.cmd"),
        Bun.which("openhop"),
      ]),
      doctor: firstExisting([
        join(bin, "openhop-doctor.cmd"),
        Bun.which("openhop-doctor"),
        Bun.which("openhop-doctor.cmd"),
      ]),
    };
  }
  const bin = join(homedir(), ".local", "bin");
  return {
    hop: firstExisting([
      join(bin, "opencode-unlimited-hop"),
      join(bin, "openhop-hop"),
      Bun.which("opencode-unlimited-hop"),
    ]),
    doctor: firstExisting([
      join(bin, "opencode-unlimited-doctor"),
      join(bin, "openhop-doctor"),
      Bun.which("opencode-unlimited-doctor"),
    ]),
  };
}
