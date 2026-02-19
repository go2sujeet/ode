<script lang="ts">
  import { onMount } from "svelte";
  import { Moon, Sun } from "lucide-svelte";
  import Button from "$lib/components/ui/button.svelte";

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
    const storedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = storedTheme ?? (prefersDark ? "dark" : "light");
    isDarkMode = initialTheme === "dark";
    setTheme(initialTheme);
  });
</script>

<Button
  variant="outline"
  size="icon"
  type="button"
  on:click={toggleTheme}
  aria-pressed={isDarkMode}
  aria-label="Toggle dark mode"
>
  {#if isDarkMode}
    <Moon class="h-4 w-4" />
  {:else}
    <Sun class="h-4 w-4" />
  {/if}
</Button>
