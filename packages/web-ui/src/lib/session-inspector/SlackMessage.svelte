<script lang="ts">
  import { buildLiveStatusMessage } from "../../../../utils/status";
  import type { SessionMessageState } from "../../../../utils/session-inspector";

  type PreviewStatusRequest = {
    channelId: string;
    threadId: string;
    statusMessageTs: string;
    startedAt: number;
    currentText: string;
    statusFrozen?: boolean;
  };

  export let state: SessionMessageState;
  export let workingDirectory: string;

  function renderSlackMarkdown(text: string): string {
    if (!text) return "";

    let result = text;

    result = result
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    result = result.replace(/```([^`]+)```/g, "<pre>$1</pre>");
    result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
    result = result.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
    result = result.replace(/_([^_]+)_/g, "<em>$1</em>");
    result = result.replace(/~([^~]+)~/g, "<del>$1</del>");
    result = result.replace(/&lt;([^|>]+)\|([^>]+)&gt;/g, '<a href="$1" target="_blank">$2</a>');
    result = result.replace(/&lt;([^>]+)&gt;/g, '<a href="$1" target="_blank">$1</a>');

    return result;
  }

  $: previewRequest = ({
    channelId: "preview-channel",
    threadId: "preview-thread",
    statusMessageTs: "preview-status",
    startedAt: state.startedAt,
    currentText: state.currentText,
    statusFrozen: false,
  }) satisfies PreviewStatusRequest;

  $: liveStatusText = buildLiveStatusMessage(previewRequest, workingDirectory, state);
  $: renderedText = renderSlackMarkdown(liveStatusText);
</script>

<div class="slack-message">
  <div class="message-text">{@html renderedText}</div>
</div>

<style>
  .slack-message {
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 1rem 1.1rem;
    box-shadow: var(--shadow-soft);
  }

  .message-text {
    color: var(--ink);
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .message-text :global(code) {
    background: var(--card);
    padding: 0.125rem 0.25rem;
    border-radius: 4px;
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.9em;
    color: #b04f7a;
  }

  .message-text :global(pre) {
    background: var(--card);
    padding: 0.75rem;
    border-radius: 10px;
    overflow-x: auto;
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.85rem;
    border: 1px solid var(--line);
  }

  .message-text :global(strong) {
    font-weight: 600;
    color: var(--ink);
  }

  .message-text :global(em) {
    font-style: italic;
  }

  .message-text :global(del) {
    text-decoration: line-through;
    opacity: 0.7;
  }

  .message-text :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .message-text :global(a:hover) {
    text-decoration: underline;
  }
</style>
