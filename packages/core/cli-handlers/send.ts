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

function printSendHelp(): void {
  console.log(
    [
      "ode send - upload files/images or post GitHub comments",
      "",
      "Usage:",
      "  ode send file <path> --channel <channelId> [--thread <threadId>] [--filename <name>] [--title <title>] [--comment <text>]",
      "  ode send github-comment --repo <owner/repo> --issue <number> --message <text>",
      "",
      "Notes:",
      "  Ode auto-detects the platform (Slack / Discord / Lark) from the channel.",
      "  --channel accepts either a raw channel id or a \"workspaceId::channelId\" value.",
      "  --thread is optional; when set, the upload lands in that thread.",
      "  --comment adds an initial message alongside the file.",
      "  Use this command to post screenshots, rendered designs, or any binary asset.",
      "  For visual checks (layout diffs, screenshots of running UI), prefer uploading the",
      "  artifact directly into the current thread so reviewers can see it inline.",
      "  For github-comment: posts a comment on a GitHub issue or PR.",
    ].join("\n"),
  );
}

async function handleSendFile(args: CliArgs): Promise<void> {
  const { flags, positional } = parseFlags(args, {
    channel: true,
    thread: true,
    filename: true,
    title: true,
    comment: true,
  });

  const filePath = positional[0];
  if (!filePath) throw new Error("File path is required: ode send file <path> --channel <channelId>");
  const channel = flags.channel as string | undefined;
  if (!channel) throw new Error("--channel is required");

  // Resolve to absolute path so the daemon — which may run from a different
  // cwd — can still find the file. Bun provides `path.resolve` via node:path.
  const { resolve: resolvePath } = await import("path");
  const absolutePath = resolvePath(process.cwd(), filePath);
  const file = Bun.file(absolutePath);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const body: Record<string, unknown> = {
    channelId: channel,
    filePath: absolutePath,
  };
  if (typeof flags.thread === "string") body.threadId = flags.thread;
  if (typeof flags.filename === "string") body.filename = flags.filename;
  if (typeof flags.title === "string") body.title = flags.title;
  if (typeof flags.comment === "string") body.initialComment = flags.comment;

  const result = await apiFetch<Record<string, unknown>>("/api/send/file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function handleSendGitHubComment(args: CliArgs): Promise<void> {
  const { flags } = parseFlags(args, {
    repo: true,
    issue: true,
    message: true,
  });

  const repo = flags.repo as string | undefined;
  const issue = flags.issue as string | undefined;
  const message = flags.message as string | undefined;

  if (!repo) throw new Error("--repo is required (e.g. owner/repo)");
  if (!issue) throw new Error("--issue is required (issue or PR number)");
  if (!message) throw new Error("--message is required");

  const result = await apiFetch<{ commentId: number }>("/api/send/github-comment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo, issueNumber: parseInt(issue, 10), body: message }),
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleSendCommand(args: CliArgs): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printSendHelp();
    return 0;
  }
  try {
    const rest = args.slice(1);
    if (sub === "file") {
      await handleSendFile(rest);
      return 0;
    }
    if (sub === "github-comment") {
      await handleSendGitHubComment(rest);
      return 0;
    }
    console.error(`Unknown send subcommand: ${sub}`);
    printSendHelp();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
