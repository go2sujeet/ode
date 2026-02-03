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

export const GET = async () => {
	const config = await readConfig();
	return json({ ok: true, config });
};

export const PUT = async ({ request }: RequestEvent) => {
	const payload = await request.json();
	const sanitized = sanitizeDashboardConfig(payload);
	await mkdir(configDir, { recursive: true });
	await writeFile(configPath, JSON.stringify(sanitized, null, 2));

	return json({ ok: true, config: sanitized });
};
