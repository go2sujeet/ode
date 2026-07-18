export { uploadSlackFile, getSlackThreadMessages, addSlackReaction, postSlackQuestion } from "./slack/api";
export * from "./discord";
export * from "./lark";
export * from "./github";
export {
  deliveryStats,
  renderDeliveryStatsForSlack,
  isRateLimitError,
  defaultDumpPath as defaultDeliveryStatsDumpPath,
} from "./shared/delivery-stats";

export async function recoverPendingRequestsAcrossPlatforms(options?: { startedBeforeMs?: number }): Promise<void> {
  const { recoverPendingRequests: recoverSlackPendingRequests } = await import("./slack/client");
  const { recoverPendingRequests: recoverDiscordPendingRequests } = await import("./discord/client");
  const { recoverPendingRequests: recoverLarkPendingRequests } = await import("./lark/client");
  const { recoverPendingRequests: recoverGitHubPendingRequests } = await import("./github/client");
  await recoverSlackPendingRequests(options);
  await recoverDiscordPendingRequests(options);
  await recoverLarkPendingRequests(options);
  await recoverGitHubPendingRequests(options);
}
