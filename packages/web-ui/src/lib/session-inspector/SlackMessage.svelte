<script lang="ts">
  export let state: {
    currentStatus: string;
    currentStep?: string;
    currentText: string;
    tools: Array<{
      id: string;
      name: string;
      status: string;
      title?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }>;
    todos: Array<{
      content: string;
      status: string;
    }>;
    startedAt: number;
  };
  export let workingDirectory: string;

  function formatElapsedTime(startedAt: number): string {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  function getToolIcon(tool: any): string {
    const name = (tool.name || "").toLowerCase();
    const status = tool.status || "";
    const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "rg", "ripgrep", "search"]);
    const READ_TOOL_NAMES = new Set(["read"]);

    if (READ_TOOL_NAMES.has(name)) return "->";
    if (SEARCH_TOOL_NAMES.has(name)) return "*";

    if (status === "pending" || status === "running") return "~";
    if (status === "error") return "!";

    return "-";
  }

  function getTodoIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✅";
      case "in_progress":
        return "▶️";
      default:
        return "◻️";
    }
  }

  function trimPath(path: string): string {
    if (!path) return path;
    if (workingDirectory && path.startsWith(`${workingDirectory}/`)) {
      return path.slice(workingDirectory.length + 1);
    }
    if (workingDirectory && path === workingDirectory) {
      return ".";
    }
    return path;
  }

  interface ToolDetails {
    name: string;
    details: string;
    output?: string;
    diffStats?: string;
    diff?: { oldString: string; newString: string };
  }

  function getToolDetails(tool: any): ToolDetails {
    const name = tool.name?.toLowerCase() ?? "";
    const input = tool.input || {};
    const metadata = tool.metadata || {};

    let details = "";
    let diffStats: string | undefined;
    let diff: { oldString: string; newString: string } | undefined;

    if (name === "grep" || name === "ripgrep" || name === "rg") {
      const pattern = input.pattern || "";
      const path = trimPath(input.path as string) || ".";
      details = `${pattern} in ${path}`;
    } else if (name === "glob") {
      const pattern = input.pattern || "";
      const path = trimPath(input.path as string) || ".";
      details = `${pattern} in ${path}`;
    } else if (name === "read") {
      const filePath = input.filePath || input.file_path;
      const offset = typeof input.offset === "number" ? input.offset : undefined;
      const limit = typeof input.limit === "number" ? input.limit : undefined;
      details = trimPath(filePath as string) || "";
      if (details && (offset !== undefined || limit !== undefined)) {
        const offsetLabel = offset !== undefined ? `offset ${offset}` : "";
        const limitLabel = limit !== undefined ? `limit ${limit}` : "";
        const rangeLabel = [offsetLabel, limitLabel].filter(Boolean).join(", ");
        details = `${details} (${rangeLabel})`;
      }
    } else if (name === "edit") {
      const filePath = input.filePath || input.file_path;
      details = trimPath(filePath as string) || "";
      const filediff = metadata.filediff as any;
      if (filediff) {
        const adds = filediff.additions || 0;
        const dels = filediff.deletions || 0;
        diffStats = `+${adds} -${dels}`;
      }
      if (input.oldString || input.newString) {
        diff = {
          oldString: (input.oldString as string) || "",
          newString: (input.newString as string) || "",
        };
      }
    } else if (name === "write") {
      const filePath = input.filePath || input.file_path;
      details = trimPath(filePath as string) || "";
    } else if (name === "bash") {
      details = (input.command as string) || "";
    } else if (tool.title) {
      details = trimPath(tool.title);
    }

    return {
      name: tool.name || "Unknown",
      details,
      output: tool.output || tool.error,
      diffStats,
      diff,
    };
  }

  interface DiffLine {
    type: "add" | "remove" | "context";
    text: string;
  }

  function computeDiff(oldStr: string, newStr: string, maxLines: number): { left: DiffLine[]; right: DiffLine[] } {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");

    let prefixLen = 0;
    while (prefixLen < oldLines.length && prefixLen < newLines.length && oldLines[prefixLen] === newLines[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < oldLines.length - prefixLen &&
      suffixLen < newLines.length - prefixLen &&
      oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    const left: DiffLine[] = [];
    const right: DiffLine[] = [];

    const contextBefore = Math.min(prefixLen, 2);
    for (let i = prefixLen - contextBefore; i < prefixLen; i++) {
      if (i >= 0) {
        left.push({ type: "context", text: " " + oldLines[i] });
        right.push({ type: "context", text: " " + newLines[i] });
      }
    }

    const oldMiddleStart = prefixLen;
    const oldMiddleEnd = oldLines.length - suffixLen;
    for (let i = oldMiddleStart; i < oldMiddleEnd; i++) {
      left.push({ type: "remove", text: "-" + oldLines[i] });
    }

    const newMiddleStart = prefixLen;
    const newMiddleEnd = newLines.length - suffixLen;
    for (let i = newMiddleStart; i < newMiddleEnd; i++) {
      right.push({ type: "add", text: "+" + newLines[i] });
    }

    while (left.length < right.length) {
      left.push({ type: "context", text: "" });
    }
    while (right.length < left.length) {
      right.push({ type: "context", text: "" });
    }

    const contextAfter = Math.min(suffixLen, 2);
    const oldSuffixStart = oldLines.length - suffixLen;
    const newSuffixStart = newLines.length - suffixLen;
    for (let i = 0; i < contextAfter; i++) {
      left.push({ type: "context", text: " " + oldLines[oldSuffixStart + i] });
      right.push({ type: "context", text: " " + newLines[newSuffixStart + i] });
    }

    if (left.length > maxLines) {
      return { left: left.slice(0, maxLines), right: right.slice(0, maxLines) };
    }

    return { left, right };
  }

  function renderSlackMarkdown(text: string): string {
    if (!text) return "";

    let result = text;

    result = result.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(/```([^`]+)```/g, "<pre>$1</pre>");
    result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
    result = result.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
    result = result.replace(/_([^_]+)_/g, "<em>$1</em>");
    result = result.replace(/~([^~]+)~/g, "<del>$1</del>");
    result = result.replace(/&lt;([^|>]+)\|([^>]+)&gt;/g, "<a href=\"$1\" target=\"_blank\">$2</a>");
    result = result.replace(/&lt;([^>]+)&gt;/g, "<a href=\"$1\" target=\"_blank\">$1</a>");

    return result;
  }

  $: renderedText = renderSlackMarkdown(state.currentText);
</script>

<div class="slack-message">
  <div class="status-section">
    <div class="status-line">
      <span class="status-icon">⚡</span>
      <span class="status-text">{state.currentStatus}</span>
      {#if state.currentStep}
        <span class="status-step">→ {state.currentStep}</span>
      {/if}
      <span class="elapsed-time">{formatElapsedTime(state.startedAt)}</span>
    </div>
  </div>

  {#if state.todos.length > 0}
    <div class="todos-section">
      <div class="section-title">Tasks</div>
      {#each state.todos as todo}
        <div class="todo-item">
          <span class="todo-icon">{getTodoIcon(todo.status)}</span>
          <span class="todo-content">{todo.content}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if state.tools.length > 0}
    <div class="tools-section">
      <div class="section-title">Tool execution</div>
      {#each state.tools as tool}
        {@const details = getToolDetails(tool)}
        <div class="tool-item">
          <span class="tool-icon">{getToolIcon(tool)}</span>
          <span class="tool-name">{details.name}</span>
          {#if details.details}
            <span class="tool-details" class:wrap-details={details.name.toLowerCase() === "read"}>
              {details.details}
            </span>
          {/if}
          {#if details.diffStats}
            <span class="tool-diff-stats">{details.diffStats}</span>
          {/if}
        </div>
        {#if details.diff}
          {@const diffResult = computeDiff(details.diff.oldString, details.diff.newString, 10)}
          <div class="tool-diff">
            <div class="diff-side">
              {#each diffResult.left as line}
                <div class="diff-line {line.type}">{line.text}</div>
              {/each}
            </div>
            <div class="diff-side">
              {#each diffResult.right as line}
                <div class="diff-line {line.type}">{line.text}</div>
              {/each}
            </div>
          </div>
        {/if}
        {#if details.output}
          <div class="tool-output">{details.output}</div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if state.currentText}
    <div class="text-section">
      <div class="section-title">Response</div>
      <div class="message-text">
        {@html renderedText}
      </div>
    </div>
  {/if}
</div>

<style>
  .slack-message {
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 1rem 1.1rem;
    box-shadow: var(--shadow-soft);
  }

  .status-section {
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 1rem;
  }

  .status-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .status-text {
    color: var(--ink);
    font-weight: 600;
  }

  .status-step {
    color: var(--ink-soft);
    font-style: italic;
  }

  .elapsed-time {
    margin-left: auto;
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
  }

  .section-title {
    font-weight: 600;
    color: var(--ink-soft);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  .todos-section,
  .tools-section,
  .text-section {
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }

  .todos-section:last-child,
  .tools-section:last-child,
  .text-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  .todo-item,
  .tool-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0;
  }

  .todo-content {
    flex: 1;
    color: var(--ink);
  }

  .tool-name {
    color: var(--accent-strong);
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 60px;
  }

  .tool-details {
    flex: 1;
    color: var(--ink);
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-details.wrap-details {
    overflow: visible;
    text-overflow: unset;
    white-space: normal;
    word-break: break-word;
  }

  .tool-diff-stats {
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--ink-soft);
    background: var(--card);
    padding: 0.125rem 0.375rem;
    border-radius: 6px;
    margin-left: auto;
  }

  .tool-diff {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    margin: 0.5rem 0 0.5rem 1.75rem;
    background: var(--line);
    border-radius: 10px;
    overflow: hidden;
  }

  .diff-side {
    background: var(--card);
    padding: 0.375rem 0;
    overflow-x: auto;
  }

  .diff-line {
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.7rem;
    padding: 0 0.5rem;
    white-space: pre;
    min-height: 1.25rem;
    line-height: 1.25rem;
  }

  .diff-line.context {
    color: var(--ink-soft);
  }

  .diff-line.remove {
    color: #b84c4c;
    background: rgba(184, 76, 76, 0.1);
  }

  .diff-line.add {
    color: #2c7a4c;
    background: rgba(44, 122, 76, 0.1);
  }

  .tool-output {
    color: var(--ink-soft);
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.8rem;
    margin-left: 1.75rem;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: var(--card);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 100px;
    overflow-y: auto;
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
