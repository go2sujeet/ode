<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    void goto("/", { replaceState: true });
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
