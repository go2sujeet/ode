import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		alias: {
			'@ode/config': resolve(dirname(fileURLToPath(import.meta.url)), '../config/index.ts'),
			'@ode/config/*': resolve(dirname(fileURLToPath(import.meta.url)), '../config/*'),
			'@ode/config/dashboard-config': resolve(dirname(fileURLToPath(import.meta.url)), '../config/dashboard-config.ts'),
			'@ode/utils': resolve(dirname(fileURLToPath(import.meta.url)), '../utils/index.ts'),
			'@ode/utils/*': resolve(dirname(fileURLToPath(import.meta.url)), '../utils/*'),
			'@ode/ims': resolve(dirname(fileURLToPath(import.meta.url)), '../ims/index.ts'),
			'@ode/ims/*': resolve(dirname(fileURLToPath(import.meta.url)), '../ims/*'),
			'@ode/agents': resolve(dirname(fileURLToPath(import.meta.url)), '../agents/index.ts'),
			'@ode/agents/*': resolve(dirname(fileURLToPath(import.meta.url)), '../agents/*')
		},
		adapter: adapter({
			fallback: 'index.html',
			strict: false
		}),
		prerender: {
			handleUnseenRoutes: 'ignore'
		}
	}
};

export default config;
