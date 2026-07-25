import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Thread } from "@/shared/contracts";

const mocks = vi.hoisted(() => ({
  dbUpsertThread: vi.fn<() => Promise<void>>(async () => {}),
  agentStatuses: [
    {
      kind: "claude",
      label: "Claude",
      installed: true,
      capabilities: {
        models: [{ id: "claude-sonnet-4" }],
        thinkingModels: [],
        approvalPolicies: [],
        sandboxModes: [],
        quickApprovalPolicies: [],
        modes: [],
        templateResolutions: [],
        contextSizes: [],
        contextHistorySizes: [],
        efforts: [],
        modelEfforts: {},
        defaultEffort: undefined,
      },
    },
  ],
}));

let storeThreads: Thread[] = [];
let campaignActiveChatByKey: Record<string, string> = {};

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    dbUpsertThread: mocks.dbUpsertThread,
  }),
}));

vi.mock("@/renderer/i18n/i18n", () => ({ i18n: { _: (m: { message: string }) => m.message } }));

vi.mock("@/renderer/state/agentStatusesStore", () => ({
  useAgentStatusesStore: {
    getState: () => ({ agentStatuses: mocks.agentStatuses }),
  },
}));

let nextThreadId = 0;

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      get projects() {
        return [
          {
            id: "project-1",
            name: "Campaign",
            purpose: "campaign",
            campaignExtension: {
              campaignGroupId: "group-1",
              clientName: "Client",
              campaignName: "Campaign",
            },
            location: { kind: "posix", path: "/tmp/camp" },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ];
      },
      get threads() {
        return storeThreads;
      },
      get campaignActiveChatByKey() {
        return campaignActiveChatByKey;
      },
      createThread(input: {
        projectId: string;
        agentKind: string;
        config: { model: string; mode: string };
        title: string;
        presentationMode: string;
      }) {
        const thread: Thread = {
          id: `thread-${++nextThreadId}`,
          projectId: input.projectId,
          title: input.title,
          agentKind: input.agentKind as Thread["agentKind"],
          config: input.config as Thread["config"],
          status: "inactive",
          attention: "none",
          canResumeWithConfig: false,
          archived: false,
          done: false,
          starred: false,
          presentationMode: input.presentationMode as "gui",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        };
        storeThreads = [...storeThreads, thread];
        return thread;
      },
      deleteThread(id: string) {
        storeThreads = storeThreads.filter((thread) => thread.id !== id);
      },
      setCampaignActiveChat(workspaceKey: string, threadId: string | null) {
        if (!threadId) {
          const next = { ...campaignActiveChatByKey };
          delete next[workspaceKey];
          campaignActiveChatByKey = next;
          return;
        }
        campaignActiveChatByKey = { ...campaignActiveChatByKey, [workspaceKey]: threadId };
      },
    }),
  },
}));

const { createCampaignChat, getActiveCampaignChatId, selectCampaignChat } =
  await import("@/renderer/actions/campaignChatThreadActions");

describe("campaign chat thread actions", () => {
  beforeEach(() => {
    storeThreads = [];
    campaignActiveChatByKey = {};
    nextThreadId = 0;
    mocks.dbUpsertThread.mockClear();
  });

  test("New chat creates via createThread and switches to it", async () => {
    const threadId = await createCampaignChat({
      projectId: "project-1",
      campaignGroupId: "group-1",
    });

    expect(threadId).toBe("thread-1");
    expect(storeThreads).toHaveLength(1);
    expect(storeThreads[0]?.title).toBe("New chat");
    expect(mocks.dbUpsertThread).toHaveBeenCalledTimes(1);
    expect(getActiveCampaignChatId("project-1", "group-1")).toBe("thread-1");
  });

  test("persists active chat per campaign workspace key", () => {
    storeThreads = [
      {
        id: "chat-a",
        projectId: "project-1",
        title: "Chat A",
        agentKind: "claude",
        config: { model: "claude-sonnet-4" },
        status: "idle",
        attention: "none",
        canResumeWithConfig: false,
        archived: false,
        done: false,
        starred: false,
        presentationMode: "gui",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ];

    expect(
      selectCampaignChat({
        projectId: "project-1",
        campaignGroupId: "group-1",
        threadId: "chat-a",
      }),
    ).toBe("chat-a");
    expect(getActiveCampaignChatId("project-1", "group-1")).toBe("chat-a");
    expect(getActiveCampaignChatId("project-1", "group-2")).toBeUndefined();
  });
});
