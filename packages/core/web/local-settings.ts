import {
  readDashboardConfig,
  writeDashboardConfig,
  updateDashboardConfig,
  type DashboardConfig,
} from "@/config";

export const readLocalSettings = async (): Promise<DashboardConfig> => {
  return readDashboardConfig();
};

export const writeLocalSettings = async (config: DashboardConfig): Promise<void> => {
  writeDashboardConfig(config);
};

export const updateLocalSettings = async (
  updater: (config: DashboardConfig) => DashboardConfig
): Promise<DashboardConfig> => updateDashboardConfig(updater);

export { discoverSlackWorkspace, syncSlackWorkspace } from "./local-settings/slack";
export { discoverDiscordWorkspace, syncDiscordWorkspace } from "./local-settings/discord";
export { discoverLarkWorkspace, syncLarkWorkspace } from "./local-settings/lark";
