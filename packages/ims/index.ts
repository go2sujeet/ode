export * from "./slack";
export * from "./discord";
export * from "./lark";
export {
  deliveryStats,
  renderDeliveryStatsForSlack,
  isRateLimitError,
  defaultDumpPath as defaultDeliveryStatsDumpPath,
} from "./shared/delivery-stats";

import { recoverPendingRequests as recoverSlackPendingRequests } from "./slack/client";
import { recoverPendingRequests as recoverDiscordPendingRequests } from "./discord/client";
import { recoverPendingRequests as recoverLarkPendingRequests } from "./lark/client";

export async function recoverPendingRequestsAcrossPlatforms(options?: { startedBeforeMs?: number }): Promise<void> {
  await recoverSlackPendingRequests(options);
  await recoverDiscordPendingRequests(options);
  await recoverLarkPendingRequests(options);
}
