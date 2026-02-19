<script lang="ts">
  import { page } from "$app/stores";
  import SessionDetail from "$lib/session-inspector/SessionDetail.svelte";

  const sessionId = $derived(($page.params as Record<string, string>).sessionId);
</script>

{#if sessionId}
  <SessionDetail {sessionId} />
{:else}
  <main class="missing">Missing session id.</main>
{/if}

<style>
  .missing {
    min-height: 100vh;
    display: grid;
    place-items: center;
    color: hsl(var(--muted-foreground));
  }
</style>
