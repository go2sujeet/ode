#!/usr/bin/env bun

import { basename, join } from "path";
import { mkdtemp, chmod, copyFile, rm } from "fs/promises";
import { tmpdir } from "os";
import packageJson from "../package.json" with { type: "json" };

const args = process.argv.slice(2);
const CURRENT_VERSION = packageJson.version ?? "0.0.0";

function printHelp(): void {
  // Keep this minimal; runtime.ts already handles --local/--cloud parsing.
  console.log(
    [
      "ode - OpenCode Slack bot",
      "",
      "Usage:",
      "  ode [--local|--cloud]",
      "  ode upgrade",
      "  ode --version",
      "",
      "Examples:",
      "  ode --local",
      "  ode --cloud",
      "  ode upgrade",
    ].join("\n")
  );
}

function resolveAsset(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    if (arch === "arm64") return "ode-darwin-arm64";
    if (arch === "x64") return "ode-darwin-x64";
  }

  if (platform === "linux") {
    if (arch === "x64") return "ode-linux-x64";
  }

  if (platform === "win32") {
    if (arch === "x64") return "ode-windows-x64.exe";
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

async function upgrade(): Promise<void> {
  const execName = basename(process.execPath);
  if (execName !== "ode" && execName !== "ode.exe") {
    console.error("ode upgrade must be run from the installed ode binary.");
    console.error("Install with: curl -fsSL https://raw.githubusercontent.com/odefun/ode/main/scripts/install.sh | bash");
    process.exit(1);
  }

  let latestVersion: string | null = null;
  try {
    const latestResponse = await fetch("https://api.github.com/repos/odefun/ode/releases/latest");
    if (latestResponse.ok) {
      const latest = (await latestResponse.json()) as { tag_name?: string };
      if (latest.tag_name) {
        latestVersion = latest.tag_name.replace(/^v/, "");
      }
    }
  } catch {
    latestVersion = null;
  }

  const asset = resolveAsset();
  const url = `https://github.com/odefun/ode/releases/latest/download/${asset}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "ode-upgrade-"));
  const tempPath = join(tempDir, asset);
  const data = new Uint8Array(await response.arrayBuffer());
  await Bun.write(tempPath, data);
  if (process.platform !== "win32") {
    await chmod(tempPath, 0o755);
  }

  try {
    await copyFile(tempPath, process.execPath);
    if (process.platform !== "win32") {
      await chmod(process.execPath, 0o755);
    }
  } catch (error) {
    console.error("Failed to replace the existing ode binary.");
    console.error("Try running with elevated permissions or reinstall to a writable directory.");
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (latestVersion) {
    console.log(`ode upgraded (current version: ${latestVersion}).`);
    return;
  }

  console.log("ode upgraded.");
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args[0] === "version") {
  console.log(CURRENT_VERSION);
  process.exit(0);
}

if (args[0] === "upgrade") {
  await upgrade();
  process.exit(0);
}

await import("./index");
