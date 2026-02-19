<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  const workspaceName = $derived(($page.params as Record<string, string>).workspaceName ?? "");

  onMount(() => {
    const encoded = encodeURIComponent(decodeURIComponent(workspaceName));
    void goto(`/slack-bot/${encoded}`, { replaceState: true });
  });
</script>

<main class="redirect">
  <p>Redirecting to settings...</p>
</main>

<style>
  .redirect {
    display: grid;
    min-height: 100vh;
    place-items: center;
    color: hsl(var(--muted-foreground));
  }
</style>
