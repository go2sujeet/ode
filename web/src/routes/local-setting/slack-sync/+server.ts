import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDashboardConfig, sanitizeDashboardConfig } from "$lib/localConfig";

const configDir = join(homedir(), ".config", "ode");
const configPath = join(configDir, "ode.json");

type DashboardConfig = typeof defaultDashboardConfig;

const readConfig = async (): Promise<DashboardConfig> => {
	try {
		const raw = await readFile(configPath, "utf-8");
		return sanitizeDashboardConfig(JSON.parse(raw));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return defaultDashboardConfig;
		}
		return defaultDashboardConfig;
	}
};

const writeConfig = async (config: DashboardConfig) => {
	await mkdir(configDir, { recursive: true });
	await writeFile(configPath, JSON.stringify(config, null, 2));
};

type SlackChannel = {
	id: string;
	name: string;
};

const slackRequest = async <T>(token: string, path: string, params?: URLSearchParams) => {
	const url = new URL(`https://slack.com/api/${path}`);
	if (params) {
		url.search = params.toString();
	}
	const response = await fetch(url.toString(), {
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/x-www-form-urlencoded"
		}
	});
	const data = (await response.json()) as T & { ok?: boolean; error?: string };
	if (!data.ok) {
		const message = data.error ?? "Slack API error";
		throw new Error(message);
	}
	return data;
};

const fetchSlackChannels = async (token: string) => {
	const channels: SlackChannel[] = [];
	let cursor = "";
	do {
		const params = new URLSearchParams({
			limit: "200",
			types: "public_channel,private_channel",
			exclude_archived: "true"
		});
		if (cursor) params.set("cursor", cursor);
		const data = await slackRequest<{ channels: SlackChannel[]; response_metadata?: { next_cursor?: string } }>(
			token,
			"conversations.list",
			params
		);
		channels.push(...(data.channels ?? []));
		cursor = data.response_metadata?.next_cursor ?? "";
	} while (cursor);
	return channels;
};

export const POST = async ({ request }: RequestEvent) => {
	const payload = await request.json();
	const workspaceId = typeof payload?.workspaceId === "string" ? payload.workspaceId : "";
	if (!workspaceId) {
		return json({ ok: false, error: "Missing workspaceId" }, { status: 400 });
	}

	const config = await readConfig();
	const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
	if (workspaceIndex === -1) {
		return json({ ok: false, error: "Workspace not found" }, { status: 404 });
	}

	const workspace = config.workspaces[workspaceIndex];
	const botToken = workspace.slackBotToken?.trim() ?? "";
	if (!botToken) {
		return json({ ok: false, error: "Missing Slack bot token" }, { status: 400 });
	}

	try {
		const teamInfo = await slackRequest<{ team: { name?: string; domain?: string } }>(
			botToken,
			"team.info"
		);
		const slackChannels = await fetchSlackChannels(botToken);
		const fallbackDevServerId = config.devServers[0]?.id ?? null;
		const fallbackModel = config.devServers[0]?.models?.[0] ?? "";

		const channelDetails = slackChannels.map((channel) => {
			const existing = workspace.channelDetails.find((item) => item.id === channel.id);
			return {
				id: channel.id,
				name: channel.name ? `#${channel.name}` : "",
				model: existing?.model ?? fallbackModel,
				workingDirectory: existing?.workingDirectory ?? "",
				devServerId: existing?.devServerId ?? fallbackDevServerId
			};
		});

		const updatedWorkspace = {
			...workspace,
			name: teamInfo.team?.name ?? workspace.name,
			domain: teamInfo.team?.domain ? `${teamInfo.team.domain}.slack.com` : workspace.domain,
			channels: channelDetails.length,
			lastSync: new Date().toISOString(),
			channelDetails
		};

		const nextConfig = {
			...config,
			workspaces: config.workspaces.map((item, index) =>
				index === workspaceIndex ? updatedWorkspace : item
			)
		};

		await writeConfig(nextConfig);
		return json({ ok: true, workspace: updatedWorkspace });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Slack sync failed";
		return json({ ok: false, error: message }, { status: 500 });
	}
};
