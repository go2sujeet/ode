import { getWebHost, getWebPort } from "@/config";

type CliArgs = string[];

type FlagSpec = Record<string, boolean>;

function parseFlags(args: CliArgs, specs: FlagSpec): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let name: string;
      let value: string | undefined;
      if (eqIdx >= 0) {
        name = arg.slice(2, eqIdx);
        value = arg.slice(eqIdx + 1);
      } else {
        name = arg.slice(2);
      }
      const takesValue = specs[name];
      if (takesValue === undefined) {
        throw new Error(`Unknown flag: --${name}`);
      }
      if (!takesValue) {
        flags[name] = true;
        continue;
      }
      if (value === undefined) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new Error(`Flag --${name} requires a value`);
        }
        value = next;
        i += 1;
      }
      flags[name] = value;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function apiBase(): string {
  return `http://${getWebHost()}:${getWebPort()}`;
}

type ApiResponse<T> = { ok?: boolean; error?: string; result?: T };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      `Failed to reach Ode daemon at ${url}. Is the daemon running? (Try \`ode status\` / \`ode start\`.) ${String(error)}`,
    );
  }
  const payload = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  if (payload.result === undefined) {
    throw new Error("Empty response from Ode daemon");
  }
  return payload.result;
}

function printReactionHelp(): void {
  console.log(
    [
      "ode reaction - add reactions to chat messages",
      "",
      "Usage:",
      "  ode reaction add <messageId> --channel <channelId> --emoji <name> [--thread <threadId>]",
      "",
      "Notes:",
      "  Supported --emoji values: thumbsup, eyes, ok_hand (aliases: thumbup, ok).",
      "  --channel accepts either a raw channel id or a \"workspaceId::channelId\" value.",
      "  --thread is optional; Slack accepts it to scope the reaction to the right session.",
    ].join("\n"),
  );
}

async function handleReactionAdd(args: CliArgs): Promise<void> {
  const { flags, positional } = parseFlags(args, { channel: true, emoji: true, thread: true });
  const messageId = positional[0];
  if (!messageId) throw new Error("Message id is required: ode reaction add <messageId> --channel ... --emoji ...");
  const channel = flags.channel as string | undefined;
  if (!channel) throw new Error("--channel is required");
  const emoji = flags.emoji as string | undefined;
  if (!emoji) throw new Error("--emoji is required");

  const body: Record<string, unknown> = { channelId: channel, messageId, emoji };
  if (typeof flags.thread === "string") body.threadId = flags.thread;

  const result = await apiFetch<Record<string, unknown>>("/api/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleReactionCommand(args: CliArgs): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printReactionHelp();
    return 0;
  }
  try {
    const rest = args.slice(1);
    if (sub === "add") {
      await handleReactionAdd(rest);
      return 0;
    }
    console.error(`Unknown reaction subcommand: ${sub}`);
    printReactionHelp();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
