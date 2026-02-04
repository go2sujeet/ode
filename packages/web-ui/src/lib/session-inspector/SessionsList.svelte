<script lang="ts">
  import { onMount } from "svelte";

  interface SessionMeta {
    sessionId: string;
    channelId: string;
    threadId: string;
    workingDirectory: string;
    createdAt: number;
    lastActivityAt: number;
    threadOwnerUserId?: string;
    slackAppId?: string;
  }

  let sessions: SessionMeta[] = [];
  let loading = true;
  let error = "";

  onMount(async () => {
    try {
      const response = await fetch("/api/sessions");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to fetch sessions");
      }
      const payload = await response.json();
      if (!payload?.ok) {
        throw new Error(payload?.error || "Failed to fetch sessions");
      }
      sessions = payload.result ?? [];
      loading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
      loading = false;
    }
  });

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  function navigateToSession(sessionId: string) {
    window.location.href = `/sessions/${sessionId}`;
  }
</script>

<main class="page">
  <div class="hero">
    <div>
      <p class="eyebrow">Session Inspector</p>
      <h1>OpenCode session timelines</h1>
      <p class="subtitle">Replay message state, tool activity, and status changes over time.</p>
    </div>
  </div>

  <section class="card">
    <div class="card-header">
      <h2>Recent sessions</h2>
      <span class="meta">{sessions.length} sessions</span>
    </div>

    {#if loading}
      <div class="state">Loading sessions...</div>
    {:else if error}
      <div class="state error">{error}</div>
    {:else if sessions.length === 0}
      <div class="state">No sessions found.</div>
    {:else}
      <div class="table">
        <div class="table-header">
          <span>Session</span>
          <span>Channel</span>
          <span>Thread</span>
          <span>Directory</span>
          <span>Created</span>
          <span>Last activity</span>
        </div>
        {#each sessions as session}
          <button
            class="row"
            type="button"
            on:click={() => navigateToSession(session.sessionId)}
          >
            <span class="mono accent">{session.sessionId.slice(0, 8)}</span>
            <span class="mono">{session.channelId}</span>
            <span class="mono">{session.threadId}</span>
            <span class="mono trunc">{session.workingDirectory}</span>
            <span>{formatDate(session.createdAt)}</span>
            <span>{formatRelativeTime(session.lastActivityAt)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</main>

<style>
  .page {
    min-height: 100vh;
    padding: 6vh 7vw 8vh;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.7rem;
    color: var(--ink-soft);
    margin-bottom: 0.5rem;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3.2rem);
    font-family: "Space Grotesk", sans-serif;
    color: var(--ink);
    margin-bottom: 0.75rem;
  }

  .subtitle {
    max-width: 560px;
    color: var(--ink-soft);
  }

  .card {
    background: var(--card);
    border-radius: var(--radius);
    padding: 1.5rem 1.75rem;
    box-shadow: var(--shadow-soft);
    border: 1px solid var(--line);
  }

  .card-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .meta {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .state {
    padding: 1.5rem;
    text-align: center;
    color: var(--ink-soft);
  }

  .state.error {
    color: #c24f3f;
  }

  .table {
    display: grid;
    gap: 0.4rem;
  }

  .table-header,
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 2fr 1.2fr 1.1fr;
    gap: 1rem;
    align-items: center;
  }

  .table-header {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    padding: 0 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
  }

  .row {
    background: var(--bg-soft);
    border: 1px solid transparent;
    border-radius: 16px;
    padding: 0.75rem 0.5rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }

  .row:hover {
    border-color: var(--accent-muted);
    transform: translateY(-1px);
  }

  .mono {
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.85rem;
  }

  .accent {
    color: var(--accent-strong);
    font-weight: 600;
  }

  .trunc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .table-header,
    .row {
      grid-template-columns: 1.2fr 1.4fr 1.4fr;
      grid-auto-rows: auto;
      grid-row-gap: 0.4rem;
    }

    .table-header span:nth-child(n + 4),
    .row span:nth-child(n + 4) {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .page {
      padding: 4vh 6vw 7vh;
    }

    .card {
      padding: 1.25rem;
    }
  }
</style>
