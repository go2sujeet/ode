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

export async function recoverPendingRequestsAcrossPlatforms(): Promise<void> {
  await recoverSlackPendingRequests();
  await recoverDiscordPendingRequests();
  await recoverLarkPendingRequests();
}
