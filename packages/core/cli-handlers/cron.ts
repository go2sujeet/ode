import { getWebHost, getWebPort } from "@/config";
import type { CronJobRecord } from "@/config/local/cron-jobs";

type CliArgs = string[];

type FlagSpec = Record<string, boolean>; // name -> whether it takes a value

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

function formatTimestamp(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "n/a";
  return new Date(value).toISOString();
}

function printJobRow(job: CronJobRecord): void {
  const workspace = job.workspaceName || job.workspaceId || "-";
  const channel = job.channelName || job.channelId;
  const enabled = job.enabled ? "on " : "off";
  console.log(
    [
      job.id,
      enabled,
      job.lastRunStatus.padEnd(8),
      job.cronExpression.padEnd(18),
      `${workspace}/${channel}`,
      job.title,
    ].join("  "),
  );
}

function printJobDetail(job: CronJobRecord): void {
  console.log(`id:             ${job.id}`);
  console.log(`title:          ${job.title}`);
  console.log(`cronExpression: ${job.cronExpression}`);
  console.log(`enabled:        ${job.enabled ? "yes" : "no"}`);
  console.log(`platform:       ${job.platform}`);
  console.log(`workspace:      ${job.workspaceName || job.workspaceId || "-"}`);
  console.log(`channel:        ${job.channelName || job.channelId} (${job.channelId})`);
  console.log(`lastRunStatus:  ${job.lastRunStatus}`);
  console.log(`lastTriggered:  ${formatTimestamp(job.lastTriggeredAt)}`);
  console.log(`lastCompleted:  ${formatTimestamp(job.lastCompletedAt)}`);
  console.log(`createdAt:      ${formatTimestamp(job.createdAt)}`);
  console.log(`updatedAt:      ${formatTimestamp(job.updatedAt)}`);
  if (job.lastError) {
    console.log(`lastError:      ${job.lastError}`);
  }
  console.log("--- message ---");
  console.log(job.messageText);
}

function printCronHelp(): void {
  console.log(
    [
      "ode cron - recurring scheduled jobs (cron)",
      "",
      "Usage:",
      "  ode cron create --schedule <cron> --channel <channelId> --message <text> [--title <title>] [--disabled] [--run-now]",
      "  ode cron list [--enabled | --disabled] [--json]",
      "  ode cron show <id> [--json]",
      "  ode cron update <id> [--schedule <cron>] [--channel <channelId>] [--message <text>] [--title <title>] [--enabled | --disabled]",
      "  ode cron enable <id>",
      "  ode cron disable <id>",
      "  ode cron run <id>",
      "  ode cron delete <id>",
      "",
      "Notes:",
      "  --schedule uses 5-field cron syntax: `minute hour day month weekday`.",
      "  --channel accepts either a raw channel id or a \"workspaceId::channelId\" value.",
      "  Creating a job defaults to enabled; use --disabled to create a paused job.",
      "  `update` only changes the fields you pass; omit a flag to keep the current value.",
    ].join("\n"),
  );
}

async function handleCreate(args: CliArgs): Promise<void> {
  const { flags } = parseFlags(args, {
    schedule: true,
    channel: true,
    message: true,
    title: true,
    disabled: false,
    "run-now": false,
  });

  const schedule = flags.schedule as string | undefined;
  const channel = flags.channel as string | undefined;
  const message = flags.message as string | undefined;
  const disabled = flags.disabled === true;
  const runNow = flags["run-now"] === true;

  if (!schedule) throw new Error("--schedule is required");
  if (!channel) throw new Error("--channel is required");
  if (!message) throw new Error("--message is required");

  const title = (flags.title as string | undefined)?.trim()
    || message.split("\n")[0]!.slice(0, 80)
    || "Cron job";

  const result = await apiFetch<{ job: CronJobRecord }>("/api/cron-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      cronExpression: schedule,
      channelId: channel,
      messageText: message,
      enabled: !disabled,
      runImmediately: runNow,
    }),
  });
  printJobDetail(result.job);
}

async function handleList(args: CliArgs): Promise<void> {
  const { flags } = parseFlags(args, { enabled: false, disabled: false, json: false });
  const result = await apiFetch<{ jobs: CronJobRecord[] }>("/api/cron-jobs");
  let jobs = result.jobs;
  if (flags.enabled && !flags.disabled) {
    jobs = jobs.filter((job) => job.enabled);
  } else if (flags.disabled && !flags.enabled) {
    jobs = jobs.filter((job) => !job.enabled);
  }
  if (flags.json) {
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }
  if (jobs.length === 0) {
    console.log("No cron jobs.");
    return;
  }
  console.log("id  state  last_status  cron_expression      workspace/channel  title");
  console.log("-".repeat(80));
  for (const job of jobs) {
    printJobRow(job);
  }
}

async function handleShow(args: CliArgs): Promise<void> {
  const { flags, positional } = parseFlags(args, { json: false });
  const id = positional[0];
  if (!id) throw new Error("Cron job id is required: ode cron show <id>");
  const result = await apiFetch<{ job: CronJobRecord }>(`/api/cron-jobs/${encodeURIComponent(id)}`);
  if (flags.json) {
    console.log(JSON.stringify(result.job, null, 2));
    return;
  }
  printJobDetail(result.job);
}

async function handleUpdate(args: CliArgs): Promise<void> {
  const { flags, positional } = parseFlags(args, {
    schedule: true,
    channel: true,
    message: true,
    title: true,
    enabled: false,
    disabled: false,
  });
  const id = positional[0];
  if (!id) throw new Error("Cron job id is required: ode cron update <id>");

  if (flags.enabled && flags.disabled) {
    throw new Error("--enabled and --disabled cannot be combined");
  }

  const body: Record<string, unknown> = {};
  if (flags.schedule !== undefined) body.cronExpression = flags.schedule;
  if (flags.channel !== undefined) body.channelId = flags.channel;
  if (flags.message !== undefined) body.messageText = flags.message;
  if (flags.title !== undefined) body.title = flags.title;
  if (flags.enabled) body.enabled = true;
  if (flags.disabled) body.enabled = false;

  if (Object.keys(body).length === 0) {
    throw new Error("No update fields provided");
  }

  const result = await apiFetch<{ job: CronJobRecord }>(`/api/cron-jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  printJobDetail(result.job);
}

async function handleToggle(args: CliArgs, enabled: boolean): Promise<void> {
  const { positional } = parseFlags(args, {});
  const id = positional[0];
  if (!id) throw new Error(`Cron job id is required: ode cron ${enabled ? "enable" : "disable"} <id>`);
  const result = await apiFetch<{ job: CronJobRecord }>(`/api/cron-jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  console.log(`Cron job ${id} ${enabled ? "enabled" : "disabled"}.`);
  printJobDetail(result.job);
}

async function handleDelete(args: CliArgs): Promise<void> {
  const { positional } = parseFlags(args, {});
  const id = positional[0];
  if (!id) throw new Error("Cron job id is required: ode cron delete <id>");
  await apiFetch(`/api/cron-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  console.log(`Cron job ${id} deleted.`);
}

async function handleRunNow(args: CliArgs): Promise<void> {
  const { positional } = parseFlags(args, {});
  const id = positional[0];
  if (!id) throw new Error("Cron job id is required: ode cron run <id>");
  await apiFetch(`/api/cron-jobs/${encodeURIComponent(id)}/run`, { method: "POST" });
  console.log(`Cron job ${id} triggered.`);
}

export async function handleCronCommand(args: CliArgs): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printCronHelp();
    return 0;
  }
  try {
    const rest = args.slice(1);
    if (sub === "create") {
      await handleCreate(rest);
      return 0;
    }
    if (sub === "list" || sub === "ls") {
      await handleList(rest);
      return 0;
    }
    if (sub === "show" || sub === "get") {
      await handleShow(rest);
      return 0;
    }
    if (sub === "update") {
      await handleUpdate(rest);
      return 0;
    }
    if (sub === "enable") {
      await handleToggle(rest, true);
      return 0;
    }
    if (sub === "disable") {
      await handleToggle(rest, false);
      return 0;
    }
    if (sub === "delete" || sub === "rm") {
      await handleDelete(rest);
      return 0;
    }
    if (sub === "run") {
      await handleRunNow(rest);
      return 0;
    }
    console.error(`Unknown cron subcommand: ${sub}`);
    printCronHelp();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
