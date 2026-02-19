import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const parsePort = (value: string | undefined, fallback: number) => {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: process.env.ODE_WEB_HOST || '127.0.0.1',
		port: parsePort(process.env.ODE_WEB_PORT, 9293),
		fs: {
			allow: [
				resolve(dirname(fileURLToPath(import.meta.url)), '..')
			]
		}
	}
});
