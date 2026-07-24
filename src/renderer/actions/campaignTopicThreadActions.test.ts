import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getActiveCampaignTopicId,
  selectCampaignTopic,
} from "@/renderer/actions/campaignTopicThreadActions";
import {
  campaignTopicGroupId,
  campaignWorkspaceKey,
} from "@/renderer/views/CampaignWorkspace/parts/campaignTopics";

const mocks = vi.hoisted(() => ({
  dbUpsertThread: vi.fn<(thread: Thread) => Promise<void>>(async () => {}),
  agentStatuses: [
    {
      kind: "codex",
      label: "Codex",
      installed: true,
      capabilities: {
        models: [{ id: "gpt-5", label: "GPT-5" }],
        thinkingModels: [],
        approvalPolicies: [],
        sandboxModes: [],
        modes: [],
        templateResolutions: [],
        contextSizes: [],
        contextHistorySizes: [],
        efforts: [],
        modelEfforts: {},
      },
    },
  ],
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    dbUpsertThread: mocks.dbUpsertThread,
  }),
}));

vi.mock("@heroui/react", () => ({
  toast: {
    danger: vi.fn<(message: string) => void>(),
  },
}));

vi.mock("@/renderer/i18n/i18n", () => ({ i18n: { _: (m: { message: string }) => m.message } }));

vi.mock("@/renderer/state/agentStatusesStore", () => ({
  useAgentStatusesStore: {
    getState: () => ({ agentStatuses: mocks.agentStatuses }),
  },
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Campaign thread",
    agentKind: "codex",
    config: { model: "gpt-5", mode: "agent" },
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

describe("selectCampaignTopic", () => {
  beforeEach(() => {
    mocks.dbUpsertThread.mockClear();
    useAppStore.setState({
      threads: [makeThread({ id: "legacy-thread" })],
      projects: [
        {
          id: "project-1",
          name: "Campaign",
          location: { kind: "posix", path: "/repo" },
          createdAt: "2026-07-01T00:00:00.000Z",
          purpose: "campaign",
          campaignExtension: {
            campaignGroupId: "group-1",
            clientName: "Client",
            campaignName: "Campaign",
            defaultAgentKind: "codex",
            defaultModel: "gpt-5",
          },
        },
      ],
      campaignActiveTopicByKey: {},
      campaignTopicLastViewedAtByThreadId: {},
    });
  });

  it("tags the legacy monitoring thread instead of creating a duplicate", async () => {
    const threadId = await selectCampaignTopic({
      projectId: "project-1",
      campaignGroupId: "group-1",
      topicId: "monitoring",
    });

    expect(threadId).toBe("legacy-thread");
    const thread = useAppStore.getState().threads.find((entry) => entry.id === "legacy-thread");
    expect(thread?.groupId).toBe(campaignTopicGroupId("monitoring"));
    expect(mocks.dbUpsertThread).toHaveBeenCalledTimes(1);
  });

  it("lazily creates a thread for a new topic and remembers the active tab", async () => {
    const threadId = await selectCampaignTopic({
      projectId: "project-1",
      campaignGroupId: "group-1",
      topicId: "pacing",
    });

    expect(threadId).toBeDefined();
    const created = useAppStore.getState().threads.find((entry) => entry.id === threadId);
    expect(created?.groupId).toBe(campaignTopicGroupId("pacing"));
    expect(getActiveCampaignTopicId("project-1", "group-1")).toBe("pacing");
    expect(mocks.dbUpsertThread).toHaveBeenCalled();
  });

  it("reopens the same topic thread after a simulated restart", async () => {
    const firstId = await selectCampaignTopic({
      projectId: "project-1",
      campaignGroupId: "group-1",
      topicId: "client_update",
    });

    const persistedThreads = useAppStore.getState().threads;
    useAppStore.setState({
      threads: persistedThreads,
      campaignActiveTopicByKey: {
        [campaignWorkspaceKey("project-1", "group-1")]: "client_update",
      },
      campaignTopicLastViewedAtByThreadId: {},
    });

    const secondId = await selectCampaignTopic({
      projectId: "project-1",
      campaignGroupId: "group-1",
      topicId: "client_update",
    });

    expect(secondId).toBe(firstId);
    expect(
      useAppStore
        .getState()
        .threads.filter((thread) => thread.groupId === campaignTopicGroupId("client_update")),
    ).toHaveLength(1);
  });
});
