import { createInterface, type Interface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import process from "node:process";
import {
  getWebHost,
  getWebPort,
  isLocalMode,
  loadOdeConfig,
  saveOdeConfig,
  type OdeConfig,
  type WorkspaceConfig,
} from "@/config";
import { discoverSlackWorkspace } from "./web/local-settings";

type AgentId = "opencode" | "claudecode" | "codex" | "kimi";

type AgentOption = {
  id: AgentId;
  label: string;
  command: string;
  installed: boolean;
};

const agentOptions: Omit<AgentOption, "installed">[] = [
  { id: "opencode", label: "OpenCode", command: "opencode" },
  { id: "claudecode", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "kimi", label: "Kimi", command: "kimi" },
];

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function ask(rl: Interface, prompt: string): Promise<string> {
  const answer = await rl.question(prompt);
  return answer.trim();
}

async function askYesNo(rl: Interface, prompt: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]: " : " [y/N]: ";
  while (true) {
    const answer = (await ask(rl, `${prompt}${suffix}`)).toLowerCase();
    if (!answer) return defaultValue;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    console.log("Please enter y or n.");
  }
}

async function askRequired(rl: Interface, prompt: string): Promise<string> {
  while (true) {
    const value = await ask(rl, prompt);
    if (value.length > 0) return value;
    console.log("Value is required.");
  }
}

function detectAgents(): AgentOption[] {
  return agentOptions.map((agent) => ({
    ...agent,
    installed: Boolean(Bun.which(agent.command)),
  }));
}

async function selectAgentsWithKeyboard(agents: AgentOption[], defaultSelected: number[]): Promise<number[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaultSelected;
  }

  return new Promise((resolve) => {
    const selected = new Set(defaultSelected.map((index) => index - 1));
    let cursor = 0;
    const lineCount = agents.length + 2;

    const render = (initial = false): void => {
      if (!initial) {
        process.stdout.write(`\x1b[${lineCount}F`);
      }
      process.stdout.write("\x1b[J");
      console.log("Step 2/2: Select coding agents to enable.");
      console.log("Use Up/Down to move, Space to toggle, Enter to confirm.");
      for (const [index, agent] of agents.entries()) {
        const pointer = index === cursor ? ">" : " ";
        const checked = selected.has(index) ? "x" : " ";
        const status = agent.installed ? "installed" : "not found";
        console.log(` ${pointer} [${checked}] ${agent.label} (${agent.command}) - ${status}`);
      }
    };

    const cleanup = (): void => {
      process.stdin.off("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    const finalize = (): void => {
      cleanup();
      process.stdout.write("\n");
      resolve(Array.from(selected).sort((a, b) => a - b).map((index) => index + 1));
    };

    const onKeypress = (_input: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.kill(process.pid, "SIGINT");
        return;
      }

      if (key.name === "up") {
        cursor = (cursor - 1 + agents.length) % agents.length;
        render();
        return;
      }

      if (key.name === "down") {
        cursor = (cursor + 1) % agents.length;
        render();
        return;
      }

      if (key.name === "space") {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        finalize();
      }
    };

    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
    render(true);
  });
}

async function setupSlackWorkspaces(rl: Interface, config: OdeConfig): Promise<OdeConfig> {
  const wantsSetup = await askYesNo(
    rl,
    "Step 1/2: Set up Slack now? You can skip and configure it later in the web UI.",
    true
  );

  if (!wantsSetup) {
    console.log("Skipped Slack setup.");
    return config;
  }

  let nextConfig = config;
  while (true) {
    const slackBotToken = await askRequired(rl, "Paste Slack bot token (xoxb-...): ");
    const slackAppToken = await askRequired(rl, "Paste Slack app token (xapp-...): ");

    try {
      const discoveredWorkspace = await discoverSlackWorkspace(slackAppToken, slackBotToken);
      const workspace: WorkspaceConfig = {
        ...discoveredWorkspace,
        slackAppToken: discoveredWorkspace.slackAppToken ?? "",
        slackBotToken: discoveredWorkspace.slackBotToken ?? "",
        channelDetails: discoveredWorkspace.channelDetails.map((channel) => ({
          ...channel,
          agentProvider: channel.agentProvider ?? "opencode",
          baseBranch: channel.baseBranch?.trim() || "main",
          channelSystemMessage: channel.channelSystemMessage ?? "",
        })),
      };
      const existingWorkspace = nextConfig.workspaces.find((item) => item.id === workspace.id);
      if (existingWorkspace) {
        console.log(`Workspace already exists: ${existingWorkspace.name || existingWorkspace.id}`);
      } else {
        nextConfig = {
          ...nextConfig,
          workspaces: [...nextConfig.workspaces, workspace],
        };
        saveOdeConfig(nextConfig);
        console.log(`Connected Slack workspace: ${workspace.name || workspace.id}`);
      }

      const addAnother = await askYesNo(rl, "Add another Slack workspace?", false);
      if (!addAnother) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Slack setup failed: ${message}`);
      const retry = await askYesNo(rl, "Try Slack setup again?", true);
      if (!retry) break;
    }
  }

  return nextConfig;
}

async function setupCodingAgents(rl: Interface, config: OdeConfig): Promise<OdeConfig> {
  const agents = detectAgents();
  const defaultSelected = agents
    .map((agent, index) => ({ index, installed: agent.installed }))
    .filter((entry) => entry.installed)
    .map((entry) => entry.index + 1);

  rl.pause();
  let finalIndices: number[];
  try {
    finalIndices = await selectAgentsWithKeyboard(agents, defaultSelected);
  } finally {
    rl.resume();
  }
  const selectedIds = new Set<AgentId>(
    finalIndices.map((index) => agents[index - 1]!.id)
  );

  if (selectedIds.size === 0) {
    selectedIds.add("opencode");
    console.log("No agents selected; defaulting to OpenCode.");
  }

  const nextConfig: OdeConfig = {
    ...config,
    agents: {
      ...config.agents,
      opencode: {
        ...config.agents.opencode,
        enabled: selectedIds.has("opencode"),
      },
      claudecode: {
        ...config.agents.claudecode,
        enabled: selectedIds.has("claudecode"),
      },
      codex: {
        ...config.agents.codex,
        enabled: selectedIds.has("codex"),
      },
      kimi: {
        ...config.agents.kimi,
        enabled: selectedIds.has("kimi"),
      },
    },
  };

  saveOdeConfig(nextConfig);
  const enabledLabels = agents.filter((agent) => selectedIds.has(agent.id)).map((agent) => agent.label);
  console.log(`Enabled agents: ${enabledLabels.join(", ")}`);
  return nextConfig;
}

export async function runOnboarding(options?: { force?: boolean }): Promise<void> {
  if (!isLocalMode()) return;

  const force = options?.force === true;
  const config = loadOdeConfig();
  if (config.completeOnboarding && !force) return;

  if (!isInteractiveTerminal()) {
    console.log("Onboarding skipped: no interactive terminal detected.");
    console.log("Run ode in a terminal to complete onboarding.");
    return;
  }

  console.log("Welcome to Ode.");
  console.log("Let's run a quick setup.");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    let nextConfig = config;
    nextConfig = await setupSlackWorkspaces(rl, nextConfig);
    nextConfig = await setupCodingAgents(rl, nextConfig);
    nextConfig = {
      ...nextConfig,
      completeOnboarding: true,
    };
    saveOdeConfig(nextConfig);

    const enabledAgents = [
      nextConfig.agents.opencode.enabled ? "OpenCode" : null,
      nextConfig.agents.claudecode.enabled ? "Claude Code" : null,
      nextConfig.agents.codex.enabled ? "Codex" : null,
      nextConfig.agents.kimi.enabled ? "Kimi" : null,
    ].filter((value): value is string => Boolean(value));
    console.log("Onboarding complete.");
    console.log(`Slack workspaces: ${nextConfig.workspaces.length}`);
    console.log(`Agents enabled: ${enabledAgents.join(", ")}`);
    console.log(`You can update settings later at http://${getWebHost()}:${getWebPort()}/local-setting.`);
  } finally {
    rl.close();
  }
}

export async function runOnboardingIfNeeded(): Promise<void> {
  await runOnboarding({ force: false });
}
