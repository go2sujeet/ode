import { describe, expect, it } from "bun:test";
import { join } from "node:path";

function findInputBlock(markup: string, inputId: string): string | undefined {
  const inputBlocks = markup.match(/<Input\b[\s\S]*?\/>/g) ?? [];
  return inputBlocks.find((block) => block.includes(`id="${inputId}"`));
}

async function readWorkspaceSettingsMarkup(relativePath: string): Promise<string> {
  const absolutePath = join(process.cwd(), relativePath);
  return Bun.file(absolutePath).text();
}

describe("web-ui credential fields", () => {
  it("masks token fields in add workspace dialog", async () => {
    const markup = await readWorkspaceSettingsMarkup("packages/web-ui/src/routes/(settings)/+layout.svelte");

    for (const inputId of [
      "new-workspace-app-token",
      "new-workspace-bot-token",
      "new-workspace-discord-bot-token",
      "new-workspace-lark-app-secret",
    ]) {
      const block = findInputBlock(markup, inputId);
      expect(block).toBeDefined();
      expect(block).toContain('type="password"');
    }
  });

  it("masks token fields in workspace detail editor", async () => {
    const markup = await readWorkspaceSettingsMarkup("packages/web-ui/src/routes/(settings)/workspace/[workspaceName]/+page.svelte");

    for (const inputId of [
      "workspace-app-token",
      "workspace-bot-token",
      "workspace-discord-bot-token",
      "workspace-lark-app-secret",
    ]) {
      const block = findInputBlock(markup, inputId);
      expect(block).toBeDefined();
      expect(block).toContain('type="password"');
    }
  });
});
