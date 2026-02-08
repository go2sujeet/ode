import { createInterface, type Interface } from "node:readline/promises";
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

function parseSelection(input: string, max: number): number[] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const values = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (values.length === 0) return null;

  const numbers = new Set<number>();
  for (const value of values) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
      return [];
    }
    numbers.add(parsed);
  }

  return Array.from(numbers).sort((a, b) => a - b);
}

function detectAgents(): AgentOption[] {
  return agentOptions.map((agent) => ({
    ...agent,
    installed: Boolean(Bun.which(agent.command)),
  }));
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

  console.log("Step 2/2: Select coding agents to enable.");
  for (const [index, agent] of agents.entries()) {
    const selected = defaultSelected.includes(index + 1) ? "x" : " ";
    const status = agent.installed ? "installed" : "not found";
    console.log(`  ${index + 1}. [${selected}] ${agent.label} (${agent.command}) - ${status}`);
  }

  let selectedIndices: number[] | null = null;
  while (selectedIndices === null) {
    const input = await ask(
      rl,
      "Choose agents by number (comma-separated). Press Enter to keep detected defaults: "
    );
    const parsed = parseSelection(input, agents.length);
    if (parsed !== null && parsed.length === 0) {
      console.log("Please enter valid numbers from the list, like 1,3.");
      continue;
    }
    selectedIndices = parsed;
  }

  const finalIndices = selectedIndices ?? defaultSelected;
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
