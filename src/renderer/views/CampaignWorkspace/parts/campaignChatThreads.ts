import type { Thread } from "@/shared/contracts";
import { isCampaignTopicThread } from "./campaignTopicThreads";

export function isCampaignChatThread(thread: Thread): boolean {
  return (
    !thread.archived &&
    !thread.done &&
    thread.presentationMode === "gui" &&
    !isCampaignTopicThread(thread)
  );
}

export function listCampaignChatThreads(threads: readonly Thread[]): Thread[] {
  return threads.filter(isCampaignChatThread).sort((left, right) => {
    const leftAt = Math.max(new Date(left.updatedAt).getTime(), new Date(left.createdAt).getTime());
    const rightAt = Math.max(
      new Date(right.updatedAt).getTime(),
      new Date(right.createdAt).getTime(),
    );
    return rightAt - leftAt;
  });
}
