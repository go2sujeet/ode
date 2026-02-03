import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDashboardConfig, sanitizeDashboardConfig } from "$lib/localConfig";

const configDir = join(homedir(), ".config", "ode");
const configPath = join(configDir, "ode.json");

type DashboardConfig = typeof defaultDashboardConfig;

const ensureConfig = async (): Promise<DashboardConfig> => {
	try {
		const raw = await readFile(configPath, "utf-8");
		try {
			const parsed = JSON.parse(raw);
			const sanitized = sanitizeDashboardConfig(parsed);
			return sanitized;
		} catch {
			await mkdir(configDir, { recursive: true });
			await writeFile(configPath, JSON.stringify(defaultDashboardConfig, null, 2));
			return defaultDashboardConfig;
		}
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			await mkdir(configDir, { recursive: true });
			await writeFile(configPath, JSON.stringify(defaultDashboardConfig, null, 2));
			return defaultDashboardConfig;
		}
		throw error;
	}
};

export const load = async () => {
	const config = await ensureConfig();
	return {
		config
	};
};
