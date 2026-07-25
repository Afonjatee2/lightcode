import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAppStore } from "@/renderer/state/appStore";
import { campaignTopicGroupId } from "./campaignTopics";
import { CampaignThreadPane } from "./CampaignThreadPane";

const mocks = vi.hoisted(() => ({
  selectCampaignTopic: vi.fn<() => Promise<string | undefined>>(async () => "topic-thread"),
  createCampaignChat: vi.fn<() => Promise<string | undefined>>(async () => "new-chat-thread"),
  selectCampaignChat: vi.fn<(input: { threadId: string }) => string | undefined>(
    (input) => input.threadId,
  ),
  clearCampaignChatSelection: vi.fn<() => void>(),
  getActiveCampaignChatId: vi.fn<() => string | undefined>(() => undefined),
}));

vi.mock("@/renderer/actions/campaignTopicThreadActions", () => ({
  selectCampaignTopic: mocks.selectCampaignTopic,
}));

vi.mock("@/renderer/actions/campaignChatThreadActions", () => ({
  createCampaignChat: mocks.createCampaignChat,
  selectCampaignChat: mocks.selectCampaignChat,
  clearCampaignChatSelection: mocks.clearCampaignChatSelection,
  getActiveCampaignChatId: mocks.getActiveCampaignChatId,
}));

vi.mock("@/renderer/components/consultations", () => ({
  ConsultationDock: () => <div data-testid="consultation-dock" />,
}));

vi.mock("./CampaignThreadComposer", () => ({
  CampaignThreadComposer: () => <div data-testid="campaign-thread-composer" />,
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Budget review",
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
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

const identity = {
  campaignGroupId: "group-1",
  campaignName: "Live Campaign",
  clientName: "Client Ltd",
  jobNumber: null,
  lifecycleStatus: "live",
};

describe("CampaignThreadPane chats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveCampaignChatId.mockReturnValue(undefined);
    useAppStore.setState({
      threads: [
        makeThread({
          id: "topic-thread",
          groupId: campaignTopicGroupId("monitoring"),
          title: "Monitoring",
        }),
        makeThread({ id: "chat-thread", title: "Budget review" }),
      ],
      campaignActiveTopicByKey: {},
      campaignActiveChatByKey: {},
      campaignTopicLastViewedAtByThreadId: {},
    });
  });

  it("lists non-topic GUI threads in the chats dropdown", async () => {
    render(
      <CampaignThreadPane projectId="project-1" identity={identity} suggestedQuestions={[]} />,
    );

    fireEvent.click(screen.getByTestId("campaign-chats-trigger"));
    const menu = await screen.findByRole("menu", { name: /Campaign chats/i });
    expect(menu).toHaveTextContent("Budget review");
    expect(menu).not.toHaveTextContent("Monitoring");
  });

  it("creates a new chat via the existing action and switches to it", async () => {
    render(
      <CampaignThreadPane projectId="project-1" identity={identity} suggestedQuestions={[]} />,
    );

    fireEvent.click(screen.getByTestId("campaign-chats-trigger"));
    await act(async () => {
      fireEvent.click(screen.getByText("New chat"));
    });

    await waitFor(() =>
      expect(mocks.createCampaignChat).toHaveBeenCalledWith({
        projectId: "project-1",
        campaignGroupId: "group-1",
      }),
    );
  });
});
