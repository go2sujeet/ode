import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { sanitizeDashboardConfig } from "$lib/localConfig";

const configDir = join(homedir(), ".config", "ode");
const configPath = join(configDir, "ode.json");

export const PUT = async ({ request }: RequestEvent) => {
	const payload = await request.json();
	const sanitized = sanitizeDashboardConfig(payload);
	await mkdir(configDir, { recursive: true });
	await writeFile(configPath, JSON.stringify(sanitized, null, 2));

	return json({ ok: true });
};
