import type { DashboardConfig } from "../localConfig";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function getWorkspacePath(workspace: DashboardConfig["workspaces"][number]): string {
  const workspaceName = slugify(workspace.name) || "workspace-1";
  return `/workspace/${encodeURIComponent(workspaceName)}`;
}

export function getSelectedWorkspace(
  workspaceName: string | undefined,
  workspaces: DashboardConfig["workspaces"]
): DashboardConfig["workspaces"][number] | null {
  if (!workspaces.length) return null;
  if (!workspaceName) return workspaces[0] ?? null;
  const normalizedWorkspaceName = decodeURIComponent(workspaceName);
  return (
    workspaces.find((workspace) => slugify(workspace.name) === normalizedWorkspaceName) ??
    workspaces[0] ??
    null
  );
}
