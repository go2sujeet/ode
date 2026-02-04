<script lang="ts">
  import { page } from "$app/stores";
  import SessionDetail from "$lib/session-inspector/SessionDetail.svelte";

  $: sessionId = ($page.params as Record<string, string>).sessionId;
</script>

{#if sessionId}
  <SessionDetail {sessionId} />
{:else}
  <main class="missing">Missing session id.</main>
{/if}

<style>
  .missing {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft);
  }
</style>
