<script lang="ts">
	import { onMount } from "svelte";
	import { Sun, Moon } from "lucide-svelte";

	let isDarkMode = false;

	const setTheme = (theme: "light" | "dark") => {
		const root = document.documentElement;
		root.dataset.theme = theme;
		localStorage.setItem("theme", theme);
	};

	const toggleTheme = () => {
		const next = isDarkMode ? "light" : "dark";
		isDarkMode = next === "dark";
		setTheme(next);
	};

	onMount(() => {
		const storedTheme = localStorage.getItem("theme") as
			| "light"
			| "dark"
			| null;
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)"
		).matches;
		const initialTheme = storedTheme ?? (prefersDark ? "dark" : "light");
		isDarkMode = initialTheme === "dark";
		setTheme(initialTheme);
	});
</script>

<button
	class="theme-toggle"
	type="button"
	on:click={toggleTheme}
	aria-pressed={isDarkMode}
	aria-label="Toggle dark mode"
>
	<span class="toggle-track">
		<span class="toggle-thumb">
			<Sun class="toggle-icon sun" stroke-width={1.8} />
			<Moon class="toggle-icon moon" stroke-width={1.8} />
		</span>
	</span>
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 58px;
		height: 34px;
		border-radius: 999px;
		background: var(--bg-soft);
		border: 1px solid var(--line);
		padding: 0;
		min-width: 0;
		box-shadow: inset 0 1px 2px rgba(31, 29, 25, 0.1);
		transition: none;
	}

	.toggle-track {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		display: block;
		padding: 3px;
	}

	.toggle-thumb {
		position: absolute;
		top: 4px;
		left: 4px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: transparent;
		border: none;
		box-shadow: none;
		display: grid;
		place-items: center;
		transition:
			transform 0.2s ease,
			background 0.2s ease;
	}

	.toggle-thumb :global(.toggle-icon) {
		width: 14px;
		height: 14px;
		fill: currentColor;
		position: absolute;
		opacity: 1;
		transition: opacity 0.2s ease;
	}

	.toggle-thumb :global(.toggle-icon.moon) {
		opacity: 0;
	}

	.theme-toggle[aria-pressed="true"] .toggle-thumb {
		transform: translateX(24px);
		background: #fef1d9;
		color: #2d241c;
	}

	.theme-toggle[aria-pressed="true"] :global(.toggle-icon.sun) {
		opacity: 0;
	}

	.theme-toggle[aria-pressed="true"] :global(.toggle-icon.moon) {
		opacity: 1;
	}

	.theme-toggle:hover {
		transform: none;
		box-shadow: none;
	}
</style>
