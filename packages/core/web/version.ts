import { readFileSync } from "fs";
import { join } from "path";

function resolveAppVersion(): string {
  try {
    const proc = Bun.spawnSync({
      cmd: ["ode", "version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode === 0) {
      const output = Buffer.from(proc.stdout).toString("utf-8").trim();
      const match = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
      if (match?.[0]) {
        return match[0];
      }
      if (output.length > 0) {
        return output;
      }
    }
  } catch {
    // Ignore and try file fallback.
  }

  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Ignore and use fallback.
  }
  return "unknown";
}

export const APP_VERSION = resolveAppVersion();
