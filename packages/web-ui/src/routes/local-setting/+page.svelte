<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import ThemeToggle from "$lib/components/ThemeToggle.svelte";
	import {
		defaultDashboardConfig,
		TOOL_DISPLAY_CONFIG,
		type GitStrategy,
		type MessageFrequency,
	} from "$lib/localConfig";
    import { Settings, ChevronDown, RefreshCw, Plus } from "lucide-svelte";

    type Workspace = {
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
            agentProvider?: "opencode" | "claude";
            model: string;
            workingDirectory: string;
            devServerId?: string | null;
        }[];
    };

    type AgentProvider = "opencode" | "claude";

    type DevServer = {
        id: string;
        name: string;
        url: string;
        models: string[];
    };

	type UserProfile = {
		name: string;
		email: string;
		initials?: string;
		avatar?: string;
		gitStrategy: GitStrategy;
		defaultMessageFrequency: MessageFrequency;
	};

    type DashboardConfig = {
        user: UserProfile;
        devServers: DevServer[];
        workspaces: Workspace[];
    };

    export let data: { config: DashboardConfig } | undefined;
    export let initialSection: "profile" | "dev" | "slack" = "profile";
    export let initialSlug: string | null = null;

	const normalizeConfig = (config: DashboardConfig) => {
		const nextUser: UserProfile = {
			...config.user,
			gitStrategy: config.user.gitStrategy ?? "worktree",
		};
        const nextDevServers: DevServer[] = config.devServers.map((server) => ({
            ...server,
            models: [...server.models],
        }));
        const nextDefaultDevServerId = nextDevServers[0]?.id ?? null;
        const nextWorkspaces: Workspace[] = config.workspaces.map((workspace) => ({
            ...workspace,
            slackAppToken: workspace.slackAppToken ?? "",
            slackBotToken: workspace.slackBotToken ?? "",
            channelDetails: workspace.channelDetails.map((channel) => ({
                ...channel,
                agentProvider:
                    channel.agentProvider === "claude" ? "claude" : "opencode",
                devServerId: channel.devServerId ?? nextDefaultDevServerId,
            })),
        }));
        return {
            user: nextUser,
            devServers: nextDevServers,
            workspaces: nextWorkspaces,
            defaultDevServerId: nextDefaultDevServerId,
        };
    };

    const initialConfig = normalizeConfig(data?.config ?? defaultDashboardConfig);
    let user: UserProfile = { ...initialConfig.user };
    let devServers: DevServer[] = initialConfig.devServers;
    let workspaces: Workspace[] = initialConfig.workspaces;
    let defaultDevServerId = initialConfig.defaultDevServerId;
    let modelOptions: string[] = [];

    const slugify = (value: string) =>
        value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

    const getDevServerPath = (server: DevServer) =>
        `/local-setting/opencode/${slugify(server.name) || server.id}`;

    const getWorkspacePath = (workspace: Workspace) =>
        `/local-setting/slack-bot/${slugify(workspace.name) || workspace.id}`;

    let activeSection: "profile" | "dev" | "slack" = initialSection;
    let selectedDevServerId: string | null = null;
    let selectedWorkspaceId: string | null = null;
    let preferredDevServerId: string | null = null;
    let preferredWorkspaceId: string | null = null;
	let isDevServersOpen = true;
	let isWorkspacesOpen = true;
	let messageFrequency: MessageFrequency = user.defaultMessageFrequency;
	let gitStrategy: GitStrategy = user.gitStrategy ?? "worktree";
	let isAddServerOpen = false;
    let newServerName = "";
    let newServerUrl = "http://localhost:4096";
    let addServerError = "";
    let isAddSlackBotOpen = false;
    let newSlackAppToken = "";
    let newSlackBotToken = "";
    let addSlackBotError = "";
    let isSaving = false;
    let isSyncingModels = false;
    let isSyncingSlack = false;
    let isConfigLoading = false;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let routeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    let confirmDelete: {
        type: "server" | "workspace";
        id: string;
        name: string;
    } | null = null;
    type Toast = {
        id: string;
        title: string;
        description?: string;
        variant?: "default" | "destructive";
    };
    let toasts: Toast[] = [];
	const messageFrequencyOptions = Object.keys(
		TOOL_DISPLAY_CONFIG,
	) as MessageFrequency[];
	const gitStrategyOptions: GitStrategy[] = ["worktree", "default"];
	const gitStrategyLabels: Record<GitStrategy, string> = {
		worktree: "Worktree",
		default: "Default",
	};

    $: if (initialSection === "dev" && initialSlug && devServers.length) {
        preferredDevServerId =
            devServers.find(
                (server) =>
                    slugify(server.name) === initialSlug ||
                    server.id === initialSlug,
            )?.id ?? null;
    }

    $: if (initialSection === "slack" && initialSlug && workspaces.length) {
        preferredWorkspaceId =
            workspaces.find(
                (workspace) =>
                    slugify(workspace.name) === initialSlug ||
                    workspace.id === initialSlug,
            )?.id ?? null;
    }

    $: if (!selectedDevServerId && devServers.length) {
        selectedDevServerId = preferredDevServerId ?? devServers[0].id;
    }

    $: if (!selectedWorkspaceId && workspaces.length) {
        selectedWorkspaceId = preferredWorkspaceId ?? workspaces[0].id;
    }

    $: currentDevServer =
        devServers.find((server) => server.id === selectedDevServerId) ?? null;

    $: currentWorkspace =
        workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
        null;

    $: modelOptions = Array.from(
        new Set([
            ...devServers.flatMap((server) => server.models),
            ...workspaces.flatMap((workspace) =>
                workspace.channelDetails.map((channel) => channel.model),
            ),
        ]),
    ).sort();

    $: defaultDevServerId = devServers[0]?.id ?? null;

    $: if (devServers.length === 1) {
        const onlyServerId = devServers[0]?.id ?? null;
        if (onlyServerId) {
            workspaces = workspaces.map((workspace) => ({
                ...workspace,
                channelDetails: workspace.channelDetails.map((channel) => ({
                    ...channel,
                    devServerId: channel.devServerId ?? onlyServerId,
                })),
            }));
        }
    }

    const createId = () => {
        if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
            return crypto.randomUUID();
        }
        return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    const pushToast = (toast: Omit<Toast, "id">) => {
        const id = createId();
        const nextToast: Toast = {
            id,
            ...toast,
        };
        toasts = [...toasts, nextToast];
        setTimeout(() => {
            toasts = toasts.filter((item) => item.id !== id);
        }, 4000);
    };

    const openAddServer = () => {
        addServerError = "";
        newServerName = "";
        newServerUrl = "http://localhost:4096";
        isAddServerOpen = true;
    };

    const confirmAddServer = async () => {
        const trimmedName = newServerName.trim();
        if (!trimmedName) {
            addServerError = "Please enter a server name.";
            return;
        }
        const trimmedUrl = newServerUrl.trim() || "http://localhost:4096";
        const newServer: DevServer = {
            id: createId(),
            name: trimmedName,
            url: trimmedUrl,
            models: [],
        };
        devServers = [...devServers, newServer];
        selectedDevServerId = newServer.id;
        activeSection = "dev";
        isAddServerOpen = false;
        addServerError = "";
        void goto(getDevServerPath(newServer));
        await saveConfig({ showToast: false });
        await syncModelsForServer(newServer);
    };

    const applyConfig = (config: DashboardConfig) => {
        const normalized = normalizeConfig(config);
		user = normalized.user;
		messageFrequency = normalized.user.defaultMessageFrequency;
		gitStrategy = normalized.user.gitStrategy ?? "worktree";
		devServers = normalized.devServers;
        workspaces = normalized.workspaces;
        defaultDevServerId = normalized.defaultDevServerId;

        const nextDevServerId =
            normalized.devServers.find((server) => server.id === selectedDevServerId)
                ?.id ?? normalized.devServers[0]?.id ?? null;
        selectedDevServerId = nextDevServerId;

        const nextWorkspaceId =
            normalized.workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
                ?.id ?? normalized.workspaces[0]?.id ?? null;
        selectedWorkspaceId = nextWorkspaceId;
    };

    const loadConfig = async () => {
        if (isConfigLoading) return;
        isConfigLoading = true;
        try {
            const response = await fetch("/api/config");
            if (!response.ok) {
                pushToast({
                    title: "Load failed",
                    description: "Please try again.",
                    variant: "destructive",
                });
                return;
            }
            const payload = await response.json();
            if (payload?.config) {
                applyConfig(payload.config as DashboardConfig);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "Please try again.";
            pushToast({
                title: "Load failed",
                description: message,
                variant: "destructive",
            });
        } finally {
            isConfigLoading = false;
        }
    };

    const openAddSlackBot = () => {
        addSlackBotError = "";
        newSlackAppToken = "";
        newSlackBotToken = "";
        isAddSlackBotOpen = true;
    };

    const confirmAddSlackBot = async () => {
        const appToken = newSlackAppToken.trim();
        const botToken = newSlackBotToken.trim();
        if (!appToken || !botToken) {
            addSlackBotError = "Please enter both Slack tokens.";
            return;
        }
        if (!appToken.startsWith("xapp-")) {
            addSlackBotError = "Slack app token should start with xapp-.";
            return;
        }
        if (!botToken.startsWith("xoxb-")) {
            addSlackBotError = "Slack bot token should start with xoxb-.";
            return;
        }
        const newWorkspace: Workspace = {
            id: createId(),
            name: "Slack Workspace",
            domain: "",
            status: "active",
            channels: 0,
            members: 0,
            lastSync: "",
            slackAppToken: appToken,
            slackBotToken: botToken,
            channelDetails: [],
        };
        workspaces = [newWorkspace];
        selectedWorkspaceId = newWorkspace.id;
        activeSection = "slack";
        isAddSlackBotOpen = false;
        addSlackBotError = "";
        void goto(getWorkspacePath(newWorkspace));
        await saveConfig({ showToast: false });
        await syncSlackWorkspace(newWorkspace.id);
    };

    const saveConfig = async (options: { showToast?: boolean } = {}) => {
        if (isSaving) return;
        isSaving = true;
		const payload: DashboardConfig = {
			user: {
				...user,
				gitStrategy,
				defaultMessageFrequency: messageFrequency,
			},
            devServers,
            workspaces: workspaces.map((workspace) => ({
                ...workspace,
                channelDetails: workspace.channelDetails.map((channel) => ({
                    ...channel,
                    model:
                        (channel.agentProvider ?? "opencode") === "opencode"
                            ? ensureModelWithProvider(
                                  channel.model,
                                  channel.devServerId ?? null,
                              )
                            : "",
                })),
            })),
        };
        const response = await fetch("/api/config", {
            method: "PUT",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        isSaving = false;
        if (!response.ok) {
            pushToast({
                title: "Save failed",
                description: "Please try again.",
                variant: "destructive",
            });
            return;
        }
        try {
            const result = await response.json();
            if (result?.config) {
                applyConfig(result.config as DashboardConfig);
            }
        } catch {
            // ignore parse errors
        }
        if (options.showToast !== false) {
            pushToast({
                title: "Saved",
                description: "Saved to ~/.config/ode/ode.json",
            });
        }
    };

    onMount(() => {
        void loadConfig();
    });

    const scheduleAutoSave = () => {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            void saveConfig({ showToast: false });
        }, 500);
    };

    const scheduleRouteUpdate = (path: string) => {
        if (routeUpdateTimer) {
            clearTimeout(routeUpdateTimer);
        }
        routeUpdateTimer = setTimeout(() => {
            routeUpdateTimer = null;
            void goto(path, {
                replaceState: true,
                keepFocus: true,
                noScroll: true,
            });
        }, 300);
    };

    const normalizeModel = (model: unknown) => {
        if (typeof model === "string") return model;
        if (model && typeof model === "object") {
            const record = model as Record<string, unknown>;
            if (typeof record.id === "string") return record.id;
            if (typeof record.name === "string") return record.name;
            if (typeof record.slug === "string") return record.slug;
        }
        return null;
    };

    const normalizeProvider = (provider: unknown) => {
        if (!provider || typeof provider !== "object") return null;
        const record = provider as Record<string, unknown>;
        if (typeof record.name === "string") return record.name;
        if (typeof record.id === "string") return record.id;
        if (typeof record.provider === "string") return record.provider;
        if (typeof record.type === "string") return record.type;
        return null;
    };

    const withProvider = (model: string, providerName: string | null) => {
        if (!providerName || model.includes("/")) return model;
        return `${providerName}/${model}`;
    };

    const extractModels = (payload: unknown) => {
        if (!payload) return [] as string[];
        if (Array.isArray(payload)) {
            return payload
                .map(normalizeModel)
                .filter((item): item is string => Boolean(item));
        }
        if (typeof payload === "object") {
            const record = payload as Record<string, unknown>;
            const providers = record.providers;
            if (Array.isArray(providers)) {
                const providerModels = providers.flatMap((provider) => {
                    if (!provider || typeof provider !== "object")
                        return [] as string[];
                    const providerName = normalizeProvider(provider);
                    const providerRecord = provider as Record<string, unknown>;
                    const modelMap = providerRecord.models;
                    if (Array.isArray(modelMap)) {
                        return modelMap
                            .map(normalizeModel)
                            .filter((item): item is string => Boolean(item))
                            .map((item) => withProvider(item, providerName));
                    }
                    if (!modelMap || typeof modelMap !== "object")
                        return [] as string[];
                    return Object.values(modelMap as Record<string, unknown>)
                        .map(normalizeModel)
                        .filter((item): item is string => Boolean(item))
                        .map((item) => withProvider(item, providerName));
                });
                if (providerModels.length) return providerModels;
            }
            const candidates =
                record.data ??
                record.models ??
                record.supported_models ??
                record.supportedModels ??
                [];
            if (Array.isArray(candidates)) {
                return candidates
                    .map(normalizeModel)
                    .filter((item): item is string => Boolean(item));
            }
            if (record.models && typeof record.models === "object") {
                return Object.values(record.models as Record<string, unknown>)
                    .map(normalizeModel)
                    .filter((item): item is string => Boolean(item));
            }
        }
        return [] as string[];
    };

    const syncModelsForServer = async (server: DevServer) => {
        if (isSyncingModels) return;
        const baseUrl = server.url?.trim();
        if (!baseUrl) {
            pushToast({
                title: "Sync failed",
                description: "Add a server URL first.",
                variant: "destructive",
            });
            return;
        }
        isSyncingModels = true;
        try {
            const response = await fetch("/api/opencode-sync", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({ serverUrl: baseUrl }),
            });
            if (!response.ok) {
                pushToast({
                    title: "Sync failed",
                    description:
                        `${response.status} ${response.statusText}`.trim(),
                    variant: "destructive",
                });
                return;
            }
            const payload = await response.json();
            if (!payload?.ok) {
                const message = payload?.error ?? "Please try again.";
                pushToast({
                    title: "Sync failed",
                    description: message,
                    variant: "destructive",
                });
                return;
            }
            const models = Array.from(new Set(extractModels(payload.providers))).sort();
            if (!models.length) {
                pushToast({
                    title: "No models found",
                    description: "The server returned no supported models.",
                });
                return;
            }
            devServers = devServers.map((item) =>
                item.id === server.id ? { ...item, models } : item,
            );
            await saveConfig({ showToast: false });
            pushToast({
                title: "Models synced",
                description: `${models.length} models available.`,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Please try again.";
            pushToast({
                title: "Sync failed",
                description: message,
                variant: "destructive",
            });
        } finally {
            isSyncingModels = false;
        }
    };

    const syncModels = async () => {
        if (!currentDevServer) return;
        await syncModelsForServer(currentDevServer);
    };

    const ensureModelWithProvider = (
        model: string,
        devServerId: string | null,
    ) => {
        if (!model || model.includes("/")) return model;
        const serverModels = devServerId
            ? (devServers.find((server) => server.id === devServerId)?.models ??
              [])
            : modelOptions;
        const match = serverModels.find(
            (item) => item.endsWith(`/${model}`) || item === model,
        );
        return match ?? model;
    };

    const syncSlackWorkspace = async (workspaceId?: string) => {
        if (isSyncingSlack) return;
        const targetWorkspace = workspaceId
            ? workspaces.find((item) => item.id === workspaceId)
            : currentWorkspace;
        if (!targetWorkspace) return;
        isSyncingSlack = true;
        try {
            const response = await fetch("/api/slack-sync", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({ workspaceId: targetWorkspace.id }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok) {
                const message = payload?.error ?? "Please try again.";
                pushToast({
                    title: "Slack sync failed",
                    description: message,
                    variant: "destructive",
                });
                return;
            }
            if (payload.workspace) {
                workspaces = workspaces.map((item) =>
                    item.id === payload.workspace.id ? payload.workspace : item,
                );
            }
            pushToast({
                title: "Slack synced",
                description: "Workspace and channels updated.",
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Please try again.";
            pushToast({
                title: "Slack sync failed",
                description: message,
                variant: "destructive",
            });
        } finally {
            isSyncingSlack = false;
        }
    };

    const getChannelModels = (channel: Workspace["channelDetails"][number]) => {
        if ((channel.agentProvider ?? "opencode") !== "opencode") {
            return [] as string[];
        }
        const devServer = devServers.find(
            (server) => server.id === channel.devServerId,
        );
        if (devServer && devServer.models.length) {
            return devServer.models;
        }
        return modelOptions;
    };

    const agentProviderOptions: Array<{ value: AgentProvider; label: string }> = [
        { value: "opencode", label: "OpenCode" },
        { value: "claude", label: "Claude Code" },
    ];

    const requestDeleteServer = () => {
        if (!currentDevServer) return;
        confirmDelete = {
            type: "server",
            id: currentDevServer.id,
            name: currentDevServer.name,
        };
    };

    const requestDeleteWorkspace = () => {
        if (!currentWorkspace) return;
        confirmDelete = {
            type: "workspace",
            id: currentWorkspace.id,
            name: currentWorkspace.name,
        };
    };

    const confirmDeleteItem = () => {
        const target = confirmDelete;
        if (!target) return;
        if (target.type === "server") {
            const nextServers = devServers.filter(
                (server) => server.id !== target.id,
            );
            devServers = nextServers;
            if (selectedDevServerId === target.id) {
                const nextServer = nextServers[0] ?? null;
                selectedDevServerId = nextServer?.id ?? null;
                if (nextServer) {
                    void goto(getDevServerPath(nextServer));
                } else {
                    activeSection = "profile";
                    void goto("/local-setting/profile");
                }
            }
        } else {
            const nextWorkspaces = workspaces.filter(
                (workspace) => workspace.id !== target.id,
            );
            workspaces = nextWorkspaces;
            if (selectedWorkspaceId === target.id) {
                const nextWorkspace = nextWorkspaces[0] ?? null;
                selectedWorkspaceId = nextWorkspace?.id ?? null;
                if (nextWorkspace) {
                    void goto(getWorkspacePath(nextWorkspace));
                } else {
                    activeSection = "profile";
                    void goto("/local-setting/profile");
                }
            }
        }
        confirmDelete = null;
        void saveConfig({ showToast: false });
    };
</script>

<main>
    <div class="container">
        <!-- Navbar (5jmPX) -->
        <nav class="navbar">
            <div class="navbar-spacer"></div>
            <div class="navbar-title">Ode Setting</div>
            <div class="navbar-actions">
                <ThemeToggle />
            </div>
        </nav>

        <div class="main-layout">
            <!-- Sidebar (hbng5) -->
            <aside class="sidebar-card">
                <div class="sidebar-content">
                    <button
                        class="sidebar-item {activeSection === 'profile'
                            ? 'active'
                            : ''}"
                        type="button"
                        on:click={() => {
                            activeSection = "profile";
                            void goto("/local-setting/profile");
                        }}
                    >
                        <div class="sidebar-item-inner">
                            <Settings size={18} />
                            <span>Profile</span>
                        </div>
                    </button>

                    <div class="sidebar-group">
                        <button
                            class="sidebar-group-header"
                            type="button"
                            on:click={() =>
                                (isDevServersOpen = !isDevServersOpen)}
                        >
                            <div class="header-label">
                                <img
                                    src="/opencode.png"
                                    alt=""
                                    class="header-icon"
                                />
                                <span>Opencode Servers</span>
                            </div>
                            <ChevronDown
                                size={16}
                                class={isDevServersOpen ? "" : "rotate--90"}
                            />
                        </button>
                        {#if isDevServersOpen}
                            <div class="sidebar-sublist">
                                {#each devServers as server}
                                    <button
                                        class="sidebar-subitem {selectedDevServerId ===
                                            server.id && activeSection === 'dev'
                                            ? 'active'
                                            : ''}"
                                        type="button"
                                        on:click={() => {
                                            activeSection = "dev";
                                            selectedDevServerId = server.id;
                                            void goto(getDevServerPath(server));
                                        }}
                                    >
                                        <div class="indicator blue"></div>
                                        <span>{server.name}</span>
                                    </button>
                                {/each}
                                <button
                                    class="sidebar-subitem add-btn"
                                    type="button"
                                    on:click={openAddServer}
                                >
                                    <Plus size={14} />
                                    <span>Add Server</span>
                                </button>
                            </div>
                        {/if}
                    </div>

                    <div class="sidebar-group">
                        <button
                            class="sidebar-group-header"
                            type="button"
                            on:click={() =>
                                (isWorkspacesOpen = !isWorkspacesOpen)}
                        >
                            <div class="header-label">
                                <img
                                    src="/slack-logo.svg"
                                    alt=""
                                    class="header-icon"
                                />
                                <span>Slack Bot</span>
                            </div>
                            <ChevronDown
                                size={16}
                                class={isWorkspacesOpen ? "" : "rotate--90"}
                            />
                        </button>
                        {#if isWorkspacesOpen}
                            <div class="sidebar-sublist">
                                {#each workspaces as workspace}
                                    <button
                                        class="sidebar-subitem {selectedWorkspaceId ===
                                            workspace.id &&
                                        activeSection === 'slack'
                                            ? 'active'
                                            : ''}"
                                        type="button"
                                        on:click={() => {
                                            activeSection = "slack";
                                            selectedWorkspaceId = workspace.id;
                                            void goto(
                                                getWorkspacePath(workspace),
                                            );
                                        }}
                                    >
                                        <div class="indicator purple"></div>
                                        <span>{workspace.name}</span>
                                    </button>
                                {/each}
                                {#if workspaces.length === 0}
                                    <button
                                        class="sidebar-subitem add-btn"
                                        type="button"
                                        on:click={openAddSlackBot}
                                    >
                                        <Plus size={14} />
                                        <span>Add Slack Bot</span>
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            </aside>

            <!-- Content Area (Yg7Rt) -->
            <section class="content-area">
                {#if activeSection === "profile"}
                    <div class="page-header">
                        <h1>Profile</h1>
                    </div>

                    <div class="content-card">
                        <div class="profile-info">
                            <div class="info-field">
                                <label for="profile-name">Name</label>
                                <input
                                    id="profile-name"
                                    type="text"
                                    value={user.name}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        user = { ...user, name: target.value };
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                            <div class="info-field">
                                <label for="profile-email">Email Address</label>
                                <input
                                    id="profile-email"
                                    type="email"
                                    value={user.email}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        user = { ...user, email: target.value };
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                        </div>

						<div class="message-freq-group">
							<span class="message-freq-label"
								>Message Update Frequency</span
							>
							<div class="message-freq-toggle">
								{#each messageFrequencyOptions as option}
									<button
										class="message-freq-option {messageFrequency ===
										option
											? 'active'
											: ''}"
										type="button"
										on:click={() => {
											messageFrequency = option;
											user = {
												...user,
												defaultMessageFrequency:
													messageFrequency,
											};
											scheduleAutoSave();
										}}
									>
										{option.charAt(0).toUpperCase() +
											option.slice(1)}
									</button>
								{/each}
							</div>
						</div>

						<div class="git-strategy-group">
							<span class="git-strategy-label">Git Strategy</span>
							<div class="git-strategy-toggle">
								{#each gitStrategyOptions as option}
									<button
										class="git-strategy-option {gitStrategy === option
											? 'active'
											: ''}"
										type="button"
										on:click={() => {
											gitStrategy = option;
											user = { ...user, gitStrategy };
											scheduleAutoSave();
										}}
									>
										{gitStrategyLabels[option]}
									</button>
								{/each}
							</div>
							<p class="git-strategy-help">
								Worktree isolates changes per thread. Default uses the current
								working directory.
							</p>
						</div>
					</div>
				{:else if activeSection === "dev"}
                    {#if currentDevServer}
                        <div class="page-header">
                            <div class="header-main">
                                <h1>{currentDevServer.name}</h1>
                                <p>Manage your dev server configuration</p>
                            </div>
                        </div>

                        <div class="content-card">
                            <div class="input-field">
                                <label for="server-name">Name</label>
                                <input
                                    id="server-name"
                                    type="text"
                                    value={currentDevServer.name}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        devServers = devServers.map((item) =>
                                            item.id === currentDevServer.id
                                                ? {
                                                      ...item,
                                                      name: target.value,
                                                  }
                                                : item,
                                        );
                                        scheduleRouteUpdate(
                                            getDevServerPath({
                                                ...currentDevServer,
                                                name: target.value,
                                            }),
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>

                            <div class="input-field">
                                <label for="server-url">Server URL</label>
                                <input
                                    id="server-url"
                                    type="text"
                                    value={currentDevServer.url}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        devServers = devServers.map((item) =>
                                            item.id === currentDevServer.id
                                                ? { ...item, url: target.value }
                                                : item,
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>

                            <div class="models-section">
                                <div class="section-header">
                                    <h2>Models</h2>
                                    <button
                                        class="btn-sync"
                                        type="button"
                                        on:click={syncModels}
                                        disabled={isSyncingModels}
                                    >
                                        <RefreshCw
                                            size={12}
                                            class={isSyncingModels
                                                ? "spin"
                                                : ""}
                                        />
                                        <span
                                            >{isSyncingModels
                                                ? "Syncing..."
                                                : "Sync Models"}</span
                                        >
                                    </button>
                                </div>
                                <div class="models-grid">
                                    {#each currentDevServer.models as model}
                                        <div class="model-card">
                                            <span class="model-name"
                                                >{model}</span
                                            >
                                            <span class="model-desc">
                                                {model.includes("gpt")
                                                    ? "OpenAI"
                                                    : model.includes("claude")
                                                      ? "Anthropic"
                                                      : model.includes("llama")
                                                        ? "Meta"
                                                        : "AI Model"}
                                            </span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    {/if}
                {:else if activeSection === "slack"}
                    {#if currentWorkspace}
                        <div class="content-card">
                            <div class="section-header">
                                <h2>Bot info</h2>
                            </div>
                            <div class="input-field">
                                <label for="workspace-app-token"
                                    >Slack App Token</label
                                >
                                <input
                                    id="workspace-app-token"
                                    type="password"
                                    value={currentWorkspace.slackAppToken ?? ""}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        workspaces = workspaces.map((item) =>
                                            item.id === currentWorkspace.id
                                                ? {
                                                      ...item,
                                                      slackAppToken:
                                                          target.value,
                                                  }
                                                : item,
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                            <div class="input-field">
                                <label for="workspace-bot-token"
                                    >Slack Bot Token</label
                                >
                                <input
                                    id="workspace-bot-token"
                                    type="password"
                                    value={currentWorkspace.slackBotToken ?? ""}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        workspaces = workspaces.map((item) =>
                                            item.id === currentWorkspace.id
                                                ? {
                                                      ...item,
                                                      slackBotToken:
                                                          target.value,
                                                  }
                                                : item,
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                            <div class="card-actions">
                                <button
                                    class="btn-sync"
                                    type="button"
                                    on:click={() => syncSlackWorkspace()}
                                    disabled={isSyncingSlack}
                                >
                                    <RefreshCw
                                        size={12}
                                        class={isSyncingSlack ? "spin" : ""}
                                    />
                                    <span
                                        >{isSyncingSlack
                                            ? "Syncing..."
                                            : "Sync slack workspace"}</span
                                    >
                                </button>
                            </div>
                        </div>

                        <div class="content-card workspace-card">
                            <div class="input-field">
                                <label for="workspace-name"
                                    >Workspace name</label
                                >
                                <input
                                    id="workspace-name"
                                    type="text"
                                    value={currentWorkspace.name}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        workspaces = workspaces.map((item) =>
                                            item.id === currentWorkspace.id
                                                ? {
                                                      ...item,
                                                      name: target.value,
                                                  }
                                                : item,
                                        );
                                        scheduleRouteUpdate(
                                            getWorkspacePath({
                                                ...currentWorkspace,
                                                name: target.value,
                                            }),
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                            <div class="input-field">
                                <label for="workspace-domain">Domain</label>
                                <input
                                    id="workspace-domain"
                                    type="text"
                                    value={currentWorkspace.domain}
                                    on:input={(event) => {
                                        const target =
                                            event.currentTarget as HTMLInputElement;
                                        workspaces = workspaces.map((item) =>
                                            item.id === currentWorkspace.id
                                                ? {
                                                      ...item,
                                                      domain: target.value,
                                                  }
                                                : item,
                                        );
                                        scheduleAutoSave();
                                    }}
                                />
                            </div>
                        </div>

                        <div class="channels-section">
                            <div class="section-header">
                                <h2>Channels</h2>
                            </div>
                            <div class="channels-grid">
                                {#each currentWorkspace.channelDetails as channel}
                                    <div class="content-card channel-card">
                                        <div class="channel-info">
                                            <div class="channel-title">
                                                {channel.name}
                                            </div>
                                            <div class="field-static">
                                                ID: {channel.id}
                                            </div>
                                        </div>

                                        <div class="channel-controls">
                                            <div class="input-field">
                                                <label
                                                    for="channel-provider-{channel.id}"
                                                    >Provider</label
                                                >
                                                <select
                                                    id="channel-provider-{channel.id}"
                                                    value={channel.agentProvider ??
                                                        "opencode"}
                                                    on:change={(event) => {
                                                        const target =
                                                            event.currentTarget as HTMLSelectElement;
                                                        const provider =
                                                            target.value === "claude"
                                                                ? "claude"
                                                                : "opencode";
                                                        workspaces =
                                                            workspaces.map(
                                                                (ws) =>
                                                                    ws.id ===
                                                                    currentWorkspace.id
                                                                        ? {
                                                                              ...ws,
                                                                              channelDetails:
                                                                                  ws.channelDetails.map(
                                                                                      (
                                                                                          item,
                                                                                      ) => {
                                                                                          if (
                                                                                              item.id !==
                                                                                              channel.id
                                                                                          ) {
                                                                                              return item;
                                                                                          }
                                                                                          const nextModel =
                                                                                              provider ===
                                                                                              "opencode"
                                                                                                  ? ensureModelWithProvider(
                                                                                                        getChannelModels(
                                                                                                            {
                                                                                                                ...item,
                                                                                                                agentProvider:
                                                                                                                    "opencode",
                                                                                                            },
                                                                                                        )[0] ??
                                                                                                            item.model,
                                                                                                        item.devServerId ??
                                                                                                            null,
                                                                                                    )
                                                                                                  : "";
                                                                                          return {
                                                                                              ...item,
                                                                                              agentProvider:
                                                                                                  provider,
                                                                                              model: nextModel,
                                                                                          };
                                                                                      },
                                                                                  ),
                                                                          }
                                                                        : ws,
                                                            );
                                                        scheduleAutoSave();
                                                    }}
                                                >
                                                    {#each agentProviderOptions as option}
                                                        <option
                                                            value={option.value}
                                                            >{option.label}</option
                                                        >
                                                    {/each}
                                                </select>
                                            </div>

                                            {#if (channel.agentProvider ?? "opencode") === "opencode"}
                                            <div class="input-field">
                                                <label
                                                    for="channel-server-{channel.id}"
                                                    >Dev Server</label
                                                >
                                                <select
                                                    id="channel-server-{channel.id}"
                                                    value={channel.devServerId ??
                                                        ""}
                                                    on:change={(event) => {
                                                        const target =
                                                            event.currentTarget as HTMLSelectElement;
                                                        const selectedId =
                                                            target.value ||
                                                            null;
                                                        workspaces =
                                                            workspaces.map(
                                                                (ws) =>
                                                                    ws.id ===
                                                                    currentWorkspace.id
                                                                        ? {
                                                                              ...ws,
                                                                              channelDetails:
                                                                                  ws.channelDetails.map(
                                                                                      (
                                                                                          item,
                                                                                      ) =>
                                                                                          item.id ===
                                                                                          channel.id
                                                                                              ? {
                                                                                                    ...item,
                                                                                                    devServerId:
                                                                                                        selectedId,
                                                                                                    model: ensureModelWithProvider(
                                                                                                        getChannelModels(
                                                                                                            {
                                                                                                                ...item,
                                                                                                                devServerId:
                                                                                                                    selectedId,
                                                                                                            },
                                                                                                        )[0] ??
                                                                                                            item.model,
                                                                                                        selectedId,
                                                                                                    ),
                                                                                                }
                                                                                              : item,
                                                                                  ),
                                                                          }
                                                                        : ws,
                                                            );
                                                        scheduleAutoSave();
                                                    }}
                                                >
                                                    {#if devServers.length > 1}
                                                        <option value=""
                                                            >Select a server</option
                                                        >
                                                    {/if}
                                                    {#each devServers as server}
                                                        <option
                                                            value={server.id}
                                                            >{server.name}</option
                                                        >
                                                    {/each}
                                                </select>
                                            </div>

                                            <div class="input-field">
                                                <label
                                                    for="channel-model-{channel.id}"
                                                    >Model</label
                                                >
                                                <select
                                                    id="channel-model-{channel.id}"
                                                    value={ensureModelWithProvider(
                                                        channel.model,
                                                        channel.devServerId ??
                                                            null,
                                                    )}
                                                    on:change={(event) => {
                                                        const target =
                                                            event.currentTarget as HTMLSelectElement;
                                                        workspaces =
                                                            workspaces.map(
                                                                (ws) =>
                                                                    ws.id ===
                                                                    currentWorkspace.id
                                                                        ? {
                                                                              ...ws,
                                                                              channelDetails:
                                                                                  ws.channelDetails.map(
                                                                                      (
                                                                                          item,
                                                                                      ) =>
                                                                                          item.id ===
                                                                                          channel.id
                                                                                              ? {
                                                                                                    ...item,
                                                                                                    model: target.value,
                                                                                                }
                                                                                              : item,
                                                                                  ),
                                                                          }
                                                                        : ws,
                                                            );
                                                        scheduleAutoSave();
                                                    }}
                                                >
                                                    {#each getChannelModels(channel) as model}
                                                        <option value={model}
                                                            >{model}</option
                                                        >
                                                    {/each}
                                                </select>
                                            </div>
                                            {/if}
                                        </div>

                                        <div class="input-field">
                                            <label
                                                for="channel-dir-{channel.id}"
                                                >Working directory</label
                                            >
                                            <input
                                                id="channel-dir-{channel.id}"
                                                type="text"
                                                value={channel.workingDirectory}
                                                on:input={(event) => {
                                                    const target =
                                                        event.currentTarget as HTMLInputElement;
                                                    workspaces = workspaces.map(
                                                        (ws) =>
                                                            ws.id ===
                                                            currentWorkspace.id
                                                                ? {
                                                                      ...ws,
                                                                      channelDetails:
                                                                          ws.channelDetails.map(
                                                                              (
                                                                                  item,
                                                                              ) =>
                                                                                  item.id ===
                                                                                  channel.id
                                                                                      ? {
                                                                                            ...item,
                                                                                            workingDirectory:
                                                                                                target.value,
                                                                                        }
                                                                                      : item,
                                                                          ),
                                                                  }
                                                                : ws,
                                                    );
                                                    scheduleAutoSave();
                                                }}
                                            />
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}
                {/if}
                <div class="content-toolbar">
                    <div class="toolbar-main">
                        <h1>Local mode</h1>
                        <p>Config stored at `~/.config/ode/ode.json`</p>
                    </div>
                    <div class="toolbar-actions">
                        {#if activeSection === "dev" && currentDevServer}
                            <button
                                class="btn-danger"
                                type="button"
                                on:click={requestDeleteServer}
                            >
                                Delete Server
                            </button>
                        {:else if activeSection === "slack" && currentWorkspace}
                            <button
                                class="btn-danger"
                                type="button"
                                on:click={requestDeleteWorkspace}
                            >
                                Delete Workspace
                            </button>
                        {/if}
                        {#if activeSection === "profile"}
                            <button
                                class="btn-primary"
                                type="button"
                                on:click={() => saveConfig()}
                                disabled={isSaving}
                            >
                                {isSaving ? "Saving..." : "Save changes"}
                            </button>
                        {/if}
                    </div>
                </div>
            </section>
        </div>
    </div>

    <div class="toast-viewport" aria-live="polite">
        {#each toasts as toast}
            <div
                class="toast {toast.variant === 'destructive'
                    ? 'toast-destructive'
                    : ''}"
            >
                <div class="toast-title">{toast.title}</div>
                {#if toast.description}
                    <div class="toast-description">{toast.description}</div>
                {/if}
            </div>
        {/each}
    </div>

    {#if isAddServerOpen}
        <div
            class="modal-backdrop"
            role="presentation"
            on:click={() => (isAddServerOpen = false)}
        >
            <div
                class="modal"
                role="dialog"
                aria-modal="true"
                on:click|stopPropagation
                on:keydown|stopPropagation
                tabindex="0"
            >
                <div class="modal-header">
                    <h2>Add Server</h2>
                    <button
                        class="btn-icon"
                        type="button"
                        on:click={() => (isAddServerOpen = false)}
                    >
                        ✕
                    </button>
                </div>
                <div class="modal-body">
                    <div class="input-field">
                        <label for="new-server-name">Server name</label>
                        <input
                            id="new-server-name"
                            type="text"
                            value={newServerName}
                            on:input={(event) => {
                                const target =
                                    event.currentTarget as HTMLInputElement;
                                newServerName = target.value;
                            }}
                        />
                    </div>
                    <div class="input-field">
                        <label for="new-server-url">Server URL</label>
                        <input
                            id="new-server-url"
                            type="text"
                            value={newServerUrl}
                            on:input={(event) => {
                                const target =
                                    event.currentTarget as HTMLInputElement;
                                newServerUrl = target.value;
                            }}
                        />
                    </div>
                    {#if addServerError}
                        <div class="error-message">{addServerError}</div>
                    {/if}
                </div>
                <div class="modal-actions">
                    <button
                        class="btn-ghost"
                        type="button"
                        on:click={() => (isAddServerOpen = false)}
                    >
                        Cancel
                    </button>
                    <button
                        class="btn-primary"
                        type="button"
                        on:click={confirmAddServer}
                    >
                        Add Server
                    </button>
                </div>
            </div>
        </div>
    {/if}

    {#if isAddSlackBotOpen}
        <div
            class="modal-backdrop"
            role="presentation"
            on:click={() => (isAddSlackBotOpen = false)}
        >
            <div
                class="modal"
                role="dialog"
                aria-modal="true"
                on:click|stopPropagation
                on:keydown|stopPropagation
                tabindex="0"
            >
                <div class="modal-header">
                    <h2>Add Slack Bot</h2>
                    <button
                        class="btn-icon"
                        type="button"
                        on:click={() => (isAddSlackBotOpen = false)}
                    >
                        ✕
                    </button>
                </div>
                <div class="modal-body">
                    <div class="input-field">
                        <label for="new-slack-app-token">Slack App Token</label>
                        <input
                            id="new-slack-app-token"
                            type="password"
                            value={newSlackAppToken}
                            on:input={(event) => {
                                const target =
                                    event.currentTarget as HTMLInputElement;
                                newSlackAppToken = target.value;
                            }}
                        />
                    </div>
                    <div class="input-field">
                        <label for="new-slack-bot-token">Slack Bot Token</label>
                        <input
                            id="new-slack-bot-token"
                            type="password"
                            value={newSlackBotToken}
                            on:input={(event) => {
                                const target =
                                    event.currentTarget as HTMLInputElement;
                                newSlackBotToken = target.value;
                            }}
                        />
                    </div>
                    {#if addSlackBotError}
                        <div class="error-message">{addSlackBotError}</div>
                    {/if}
                </div>
                <div class="modal-actions">
                    <button
                        class="btn-ghost"
                        type="button"
                        on:click={() => (isAddSlackBotOpen = false)}
                    >
                        Cancel
                    </button>
                    <button
                        class="btn-primary"
                        type="button"
                        on:click={confirmAddSlackBot}
                    >
                        Add Slack Bot
                    </button>
                </div>
            </div>
        </div>
    {/if}

    {#if confirmDelete}
        <div
            class="modal-backdrop"
            role="presentation"
            on:click={() => (confirmDelete = null)}
        >
            <div
                class="modal"
                role="dialog"
                aria-modal="true"
                on:click|stopPropagation
                on:keydown|stopPropagation
                tabindex="0"
            >
                <div class="modal-header">
                    <h2>Confirm delete</h2>
                    <button
                        class="btn-icon"
                        type="button"
                        on:click={() => (confirmDelete = null)}
                    >
                        ✕
                    </button>
                </div>
                <div class="modal-body">
                    <p>
                        Delete this {confirmDelete.type === "server"
                            ? "server"
                            : "workspace"}:
                        <strong>{confirmDelete.name}</strong>?
                    </p>
                </div>
                <div class="modal-actions">
                    <button
                        class="btn-ghost"
                        type="button"
                        on:click={() => (confirmDelete = null)}
                    >
                        Cancel
                    </button>
                    <button
                        class="btn-danger"
                        type="button"
                        on:click={confirmDeleteItem}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    {/if}
</main>

<style>
    :global(body) {
        background: var(--bg);
    }

    .container {
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
    }

    /* Navbar (5jmPX) */
    .navbar {
        height: 64px;
        border: 1px solid var(--line);
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: 0 32px;
        background: var(--card);
        border-radius: 8px;
        margin-bottom: 0;
        width: 100%;
        box-sizing: border-box;
    }

    .navbar-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--ink);
        text-align: center;
    }

    .navbar-actions {
        display: flex;
        justify-content: flex-end;
    }

    /* Layout */
    .main-layout {
        display: grid;
        grid-template-columns: 256px 1fr;
        gap: 0;
        flex: 1;
        padding: 32px 0 0 0;
        justify-content: center;
        max-width: 1000px;
        margin: 0 auto;
        width: 100%;
    }

    /* Sidebar (hbng5) */
    .sidebar-card {
        width: 256px;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        height: fit-content;
    }

    .sidebar-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .sidebar-item {
        width: 100%;
        display: flex;
        align-items: center;
        padding: 0;
        border-radius: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        min-width: auto;
    }

    .sidebar-item-inner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        width: 100%;
        border-radius: inherit;
        font-size: 14px;
        font-weight: 500;
        color: var(--ink-soft);
    }

    .sidebar-item:hover .sidebar-item-inner,
    .sidebar-item.active .sidebar-item-inner {
        background: var(--bg-soft);
        color: var(--ink);
    }

    .sidebar-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 8px;
    }

    .sidebar-group-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        font-size: 14px;
        font-weight: 400;
        color: var(--ink-soft);
        background: transparent;
        border: none;
        cursor: pointer;
        min-width: auto;
    }

    .header-label {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .header-icon {
        width: 18px;
        height: 18px;
        object-fit: contain;
    }

    .sidebar-sublist {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-left: 8px;
    }

    .sidebar-subitem {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 14px;
        color: var(--ink-soft);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        justify-content: flex-start;
        min-width: auto;
    }

    .sidebar-subitem:hover,
    .sidebar-subitem.active {
        background: var(--bg-soft);
        color: var(--ink);
    }

    .indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
    }

    .indicator.blue {
        background: #3b82f6;
    }
    .indicator.purple {
        background: #8b5cf6;
    }

    .add-btn {
        color: var(--accent);
        font-weight: 500;
        margin-top: 4px;
    }

    /* Content Area (Yg7Rt) */
    .content-area {
        padding: 0 0 40px 32px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
    }

    .content-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px 20px;
    }

    .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .content-toolbar h1 {
        font-size: 20px;
        margin-bottom: 4px;
    }

    .content-toolbar p {
        font-size: 13px;
        color: var(--ink-soft);
    }

    .card-actions {
        display: flex;
        justify-content: flex-end;
    }

    .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
    }

    .page-header h1 {
        font-size: 32px;
        font-weight: 700;
        margin-bottom: 8px;
    }

    .page-header p {
        font-size: 16px;
        color: var(--ink-soft);
    }

    .content-card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    /* Profile Specific */
    .profile-info {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .info-field label {
        font-size: 12px;
        color: var(--ink-soft);
        display: block;
        margin-bottom: 4px;
    }

    /* Message Frequency Toggle */
    .message-freq-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .message-freq-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--ink);
    }

    .message-freq-toggle {
        display: flex;
        background: var(--bg-soft);
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 2px;
        width: fit-content;
    }

    .message-freq-option {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        color: var(--ink-soft);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 80px;
    }

    .message-freq-option.active {
        background: var(--accent);
        color: white;
    }

    .message-freq-option:hover:not(.active) {
        background: rgba(0, 0, 0, 0.05);
    }

    /* Git Strategy Toggle */
    .git-strategy-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
    }

    .git-strategy-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--ink);
    }

    .git-strategy-toggle {
        display: flex;
        background: var(--bg-soft);
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 2px;
        width: fit-content;
    }

    .git-strategy-option {
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        color: var(--ink-soft);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 90px;
    }

    .git-strategy-option.active {
        background: var(--accent);
        color: white;
    }

    .git-strategy-option:hover:not(.active) {
        background: rgba(0, 0, 0, 0.05);
    }

    .git-strategy-help {
        font-size: 12px;
        color: var(--ink-soft);
    }

    /* Form Elements */
    .input-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .input-field label {
        font-size: 14px;
        font-weight: 500;
        color: var(--ink);
    }

    input,
    select {
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--line);
        background: var(--card);
        font-size: 14px;
        color: var(--ink);
        width: 100%;
        transition: all 0.2s;
    }

    input:focus,
    select:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-muted);
    }

    /* Buttons */
    .btn-primary {
        background: var(--accent);
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        border: none;
        cursor: pointer;
        min-width: auto;
    }

    .btn-danger {
        background: #ef4444;
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        min-width: auto;
    }

    .btn-sync {
        background: var(--bg-soft);
        border: 1px solid var(--line);
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        min-width: auto;
    }

    .btn-sync:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-ghost {
        background: transparent;
        border: 1px dashed var(--accent-muted);
        color: var(--accent);
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        min-width: auto;
    }

    .btn-icon {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 16px;
    }

    /* Models Grid */
    .models-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 8px 0;
    }

    .section-header h2 {
        font-size: 14px;
        font-weight: 500;
    }

    .models-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .model-card {
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 6px 8px;
        background: var(--bg-soft);
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 120px;
    }

    .model-name {
        font-size: 12px;
        font-weight: 500;
    }

    .model-desc {
        font-size: 10px;
        color: var(--ink-soft);
    }

    .toast-viewport {
        position: fixed;
        right: 24px;
        bottom: 24px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 30;
        pointer-events: none;
    }

    .toast {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 12px 14px;
        box-shadow: var(--shadow-soft);
        min-width: 220px;
        max-width: 320px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        animation: toast-in 0.2s ease-out;
        pointer-events: auto;
    }

    .toast-destructive {
        border-color: rgba(239, 68, 68, 0.4);
        box-shadow: 0 12px 30px rgba(239, 68, 68, 0.12);
    }

    .toast-title {
        font-size: 13px;
        font-weight: 600;
    }

    .toast-description {
        font-size: 12px;
        color: var(--ink-soft);
    }

    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    /* Slack Channels */
    .channels-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
    }

    .channels-section {
        gap: 12px;
    }

    .channel-card {
        padding: 16px;
    }

    .channel-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 6px;
    }

    .channel-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--ink);
    }

    .channel-info .field-static {
        text-align: left;
        font-weight: 400;
        color: var(--ink-soft);
    }

    .field-static {
        font-size: 15px;
        color: var(--ink);
        text-align: right;
    }

    .channel-card .input-field {
        gap: 4px;
    }

    .channel-controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .workspace-card {
        gap: 16px;
    }

    @media (min-width: 1024px) {
        .channel-controls {
            flex-direction: row;
            gap: 12px;
        }

        .channel-controls .input-field {
            flex: 1;
        }
    }

    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(12, 12, 14, 0.45);
        display: grid;
        place-items: center;
        padding: 24px;
        z-index: 20;
    }

    .modal {
        width: min(420px, 100%);
        background: var(--card);
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .modal-header h2 {
        font-size: 18px;
    }

    .modal-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
    }

    .error-message {
        font-size: 12px;
        color: #ef4444;
    }

    @media (max-width: 1024px) {
        .main-layout {
            grid-template-columns: 1fr;
        }
        .sidebar-card {
            width: 100%;
            margin-bottom: 24px;
        }
        .content-area {
            padding-left: 0;
        }
        .content-toolbar {
            flex-direction: column;
            align-items: flex-start;
        }
        .toolbar-actions {
            width: 100%;
            justify-content: space-between;
        }
    }
</style>
