import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const parsePort = (value: string | undefined, fallback: number) => {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
};

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: process.env.ODE_WEB_HOST || '127.0.0.1',
		port: parsePort(process.env.ODE_WEB_PORT, 9293)
	}
});
