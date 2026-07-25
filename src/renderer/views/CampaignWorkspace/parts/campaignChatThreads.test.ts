import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { campaignTopicGroupId } from "./campaignTopics";
import { isCampaignChatThread, listCampaignChatThreads } from "./campaignChatThreads";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Campaign thread",
    agentKind: "codex",
    config: { model: "gpt-5" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("campaign chat threads", () => {
  it("includes non-topic GUI threads and excludes topic threads", () => {
    const topic = makeThread({
      id: "topic-thread",
      groupId: campaignTopicGroupId("monitoring"),
      title: "Monitoring",
    });
    const chat = makeThread({ id: "chat-thread", title: "Budget review" });
    const archived = makeThread({ id: "archived", archived: true });
    const terminal = makeThread({ id: "terminal", presentationMode: "terminal" });

    expect(isCampaignChatThread(topic)).toBe(false);
    expect(isCampaignChatThread(chat)).toBe(true);
    expect(
      listCampaignChatThreads([topic, chat, archived, terminal]).map((thread) => thread.id),
    ).toEqual(["chat-thread"]);
  });

  it("sorts chats by recency", () => {
    const older = makeThread({
      id: "older",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const newer = makeThread({
      id: "newer",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
    });

    expect(listCampaignChatThreads([older, newer]).map((thread) => thread.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});
