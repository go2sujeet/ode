export type DashboardConfig = {
	user: {
		name: string;
		email: string;
		initials?: string;
		avatar?: string;
		githubToken: string;
		defaultMessageFrequency: "aggressive" | "medium" | "minimum";
	};
	devServers: {
		id: string;
		name: string;
		url: string;
		models: string[];
	}[];
	workspaces: {
		id: string;
		name: string;
		domain: string;
		status: "active" | "paused";
		channels: number;
		members: number;
		lastSync: string;
		slackAppToken?: string;
		slackBotToken?: string;
		channelDetails: {
			id: string;
			name: string;
			model: string;
			workingDirectory: string;
			devServerId?: string | null;
		}[];
	}[];
};

export const defaultDashboardConfig: DashboardConfig = {
	user: {
		name: "",
		email: "",
		githubToken: "",
		defaultMessageFrequency: "medium"
	},
	devServers: [],
	workspaces: []
};

const asString = (value: unknown, fallback = "") =>
	typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0) =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];

const asFrequency = (value: unknown): DashboardConfig["user"]["defaultMessageFrequency"] => {
	if (value === "aggressive" || value === "minimum") return value;
	return "medium";
};

const asStatus = (value: unknown): DashboardConfig["workspaces"][number]["status"] =>
	value === "paused" ? "paused" : "active";

export const sanitizeDashboardConfig = (config: unknown): DashboardConfig => {
	if (!config || typeof config !== "object") {
		return defaultDashboardConfig;
	}

	const record = config as Record<string, unknown>;
	const user = record.user && typeof record.user === "object" ? (record.user as Record<string, unknown>) : {};

	const devServers = Array.isArray(record.devServers)
		? (record.devServers
				.map((item) => {
					if (!item || typeof item !== "object") return null;
					const server = item as Record<string, unknown>;
					return {
						id: asString(server.id),
						name: asString(server.name),
						url: asString(server.url),
						models: asStringArray(server.models)
					};
				})
				.filter(Boolean) as DashboardConfig["devServers"])
		: [];

	const workspaces = Array.isArray(record.workspaces)
		? (record.workspaces
				.map((item) => {
					if (!item || typeof item !== "object") return null;
					const workspace = item as Record<string, unknown>;
					const channelDetails = Array.isArray(workspace.channelDetails)
						? (workspace.channelDetails
								.map((channel) => {
									if (!channel || typeof channel !== "object") return null;
									const detail = channel as Record<string, unknown>;
									const devServerId =
										typeof detail.devServerId === "string"
											? detail.devServerId
											: detail.devServerId === null
												? null
												: undefined;
									return {
										id: asString(detail.id),
										name: asString(detail.name),
										model: asString(detail.model),
										workingDirectory: asString(detail.workingDirectory),
										devServerId
									};
								})
								.filter(Boolean) as DashboardConfig["workspaces"][number]["channelDetails"])
						: [];

					const slackAppToken = asString(workspace.slackAppToken, "");
					const slackBotToken = asString(workspace.slackBotToken, "");

					return {
						id: asString(workspace.id),
						name: asString(workspace.name),
						domain: asString(workspace.domain),
						status: asStatus(workspace.status),
						channels: asNumber(workspace.channels),
						members: asNumber(workspace.members),
						lastSync: asString(workspace.lastSync),
						slackAppToken: slackAppToken || undefined,
						slackBotToken: slackBotToken || undefined,
						channelDetails
					};
				})
				.filter(Boolean) as DashboardConfig["workspaces"])
		: [];

	return {
		user: {
			name: asString(user.name),
			email: asString(user.email),
			initials: asString(user.initials, "") || undefined,
			avatar: asString(user.avatar, "") || undefined,
			githubToken: asString(user.githubToken),
			defaultMessageFrequency: asFrequency(user.defaultMessageFrequency)
		},
		devServers,
		workspaces
	};
};
