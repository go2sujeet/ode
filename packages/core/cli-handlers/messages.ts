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

function printMessagesHelp(): void {
  console.log(
    [
      "ode messages - fetch messages from a chat thread/channel",
      "",
      "Usage:",
      "  ode messages get <threadId> --channel <channelId> [--limit N] [--json]",
      "",
      "Notes:",
      "  <threadId> is the thread root id (Slack `thread_ts`, Lark message id, Discord channel/thread id).",
      "  --limit caps how many replies to return (default 20).",
      "  --channel accepts either a raw channel id or a \"workspaceId::channelId\" value.",
      "  Ode auto-detects the platform (Slack / Discord / Lark) from the channel.",
    ].join("\n"),
  );
}

async function handleMessagesGet(args: CliArgs): Promise<void> {
  const { flags, positional } = parseFlags(args, { channel: true, limit: true, json: false });
  const threadId = positional[0];
  if (!threadId) throw new Error("Thread id is required: ode messages get <threadId> --channel <channelId>");
  const channel = flags.channel as string | undefined;
  if (!channel) throw new Error("--channel is required");
  const limitRaw = flags.limit as string | undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive number");
  }

  const body: Record<string, unknown> = { channelId: channel, threadId };
  if (limit !== undefined) body.limit = limit;

  const result = await apiFetch<{ platform: string; messages: unknown[] }>("/api/messages/thread", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`platform: ${result.platform}  count: ${result.messages.length}`);
  console.log("--- messages ---");
  console.log(JSON.stringify(result.messages, null, 2));
}

export async function handleMessagesCommand(args: CliArgs): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printMessagesHelp();
    return 0;
  }
  try {
    const rest = args.slice(1);
    if (sub === "get") {
      await handleMessagesGet(rest);
      return 0;
    }
    console.error(`Unknown messages subcommand: ${sub}`);
    printMessagesHelp();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
