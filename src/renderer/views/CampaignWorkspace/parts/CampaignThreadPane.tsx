import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";
import {
  clearCampaignChatSelection,
  createCampaignChat,
  getActiveCampaignChatId,
  selectCampaignChat,
} from "@/renderer/actions/campaignChatThreadActions";
import { selectCampaignTopic } from "@/renderer/actions/campaignTopicThreadActions";
import { openThread } from "@/renderer/actions/threadActions";
import { ConsultationDock } from "@/renderer/components/consultations";
import { useConsultationStore } from "@/renderer/components/consultations/consultationStore";
import { useProjectThreads } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { resolveCampaignAttachmentAbsolutePath } from "@/renderer/services/planIntelligence/resolveCampaignAttachmentPath";
import { CampaignChatsDropdown } from "./CampaignChatsDropdown";
import { CampaignThreadComposer } from "./CampaignThreadComposer";
import { mediaPlanAttachmentsFromMessage } from "./mediaPlanAttachment";
import { CAMPAIGN_TOPICS, type CampaignTopicId, campaignWorkspaceKey } from "./campaignTopics";
import { indexCampaignTopicThreads, isCampaignTopicUnread } from "./campaignTopicThreads";
import { listCampaignChatThreads } from "./campaignChatThreads";
import { Button } from "@heroui/react";
import { FileSpreadsheet } from "lucide-react";

export function CampaignThreadPane(props: {
  projectId: string;
  identity: CampaignContextIdentityViewModel | null;
  suggestedQuestions?: readonly string[];
  onAnalyzeMediaPlan?: (input: {
    filePath: string;
    filename: string;
    campaignGroupId: string;
  }) => void;
}) {
  const { t } = useLingui();
  const projectThreads = useProjectThreads(props.projectId);
  const consultationRecords = useConsultationStore((state) => state.records);
  const campaignTopicLastViewedAtByThreadId = useAppStore(
    (state) => state.campaignTopicLastViewedAtByThreadId,
  );
  const campaignGroupId = props.identity?.campaignGroupId ?? "";
  const workspaceKey = campaignWorkspaceKey(props.projectId, campaignGroupId);
  const activeTopicId = useAppStore((state) => {
    return state.campaignActiveTopicByKey[workspaceKey] ?? ("monitoring" satisfies CampaignTopicId);
  });
  const activeChatId = useAppStore(
    (state) => state.campaignActiveChatByKey[workspaceKey] ?? undefined,
  );
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [isResolvingThread, setIsResolvingThread] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const chatThreads = listCampaignChatThreads(projectThreads);

  useEffect(() => {
    if (!props.identity) {
      setActiveThreadId(undefined);
      return;
    }

    const persistedChatId = getActiveCampaignChatId(props.projectId, campaignGroupId);
    if (persistedChatId) {
      setActiveThreadId(persistedChatId);
      return;
    }

    let cancelled = false;
    setIsResolvingThread(true);
    void selectCampaignTopic({
      projectId: props.projectId,
      campaignGroupId,
      topicId: activeTopicId,
    })
      .then((threadId) => {
        if (!cancelled) setActiveThreadId(threadId);
      })
      .finally(() => {
        if (!cancelled) setIsResolvingThread(false);
      });

    return () => {
      cancelled = true;
    };
  }, [props.projectId, props.identity, campaignGroupId, activeTopicId, activeChatId]);

  const threadId = activeThreadId;
  const threadsByTopic = indexCampaignTopicThreads(projectThreads);
  const activeThread = threadId
    ? projectThreads.find((thread) => thread.id === threadId)
    : undefined;
  const isChatMode = Boolean(activeChatId && threadId === activeChatId);
  const hasConsultations = useConsultationStore((state) =>
    threadId
      ? [...state.records.values()].some((record) => record.parentThreadId === threadId)
      : false,
  );
  const mediaPlanPrompts = (() => {
    if (!threadId) return [];
    const prompts: Array<{ recordId: string; path: string; fileName: string }> = [];
    for (const record of consultationRecords.values()) {
      if (record.parentThreadId !== threadId) continue;
      for (const attachment of mediaPlanAttachmentsFromMessage(record.originalInstruction)) {
        prompts.push({ recordId: record.id, ...attachment });
      }
    }
    return prompts;
  })();

  if (!props.identity) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <p>
          <Trans>Select a campaign to view its thread</Trans>
        </p>
      </div>
    );
  }

  const clientDisplay = props.identity.clientName ?? "—";
  const campaignDisplay = props.identity.campaignName;
  const defaultProvider = activeThread?.agentKind ?? "claude";

  function handleSelectTopic(topicId: CampaignTopicId) {
    if (topicId === activeTopicId && !isChatMode) return;
    if (isResolvingThread) return;
    clearCampaignChatSelection(props.projectId, campaignGroupId);
    setIsResolvingThread(true);
    void selectCampaignTopic({
      projectId: props.projectId,
      campaignGroupId,
      topicId,
    })
      .then((nextThreadId) => setActiveThreadId(nextThreadId))
      .finally(() => setIsResolvingThread(false));
  }

  function handleSelectChat(nextThreadId: string) {
    const resolved = selectCampaignChat({
      projectId: props.projectId,
      campaignGroupId,
      threadId: nextThreadId,
    });
    if (resolved) setActiveThreadId(resolved);
  }

  function handleNewChat() {
    if (isCreatingChat) return;
    setIsCreatingChat(true);
    void createCampaignChat({ projectId: props.projectId, campaignGroupId })
      .then((nextThreadId) => {
        if (nextThreadId) setActiveThreadId(nextThreadId);
      })
      .finally(() => setIsCreatingChat(false));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-5 pt-3.5">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          {clientDisplay} — {campaignDisplay}
        </h3>
        <div className="mt-3 flex items-end gap-2 border-b border-[var(--hairline)]">
          <div
            className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
            role="tablist"
            aria-label={t`Thread topics`}
          >
            {CAMPAIGN_TOPICS.map((tab) => {
              const topicThread = threadsByTopic[tab.id];
              const unread = isCampaignTopicUnread({
                thread: topicThread,
                isActive: !isChatMode && tab.id === activeTopicId,
                lastViewedAtMs: topicThread
                  ? campaignTopicLastViewedAtByThreadId[topicThread.id]
                  : undefined,
                consultationRecords: consultationRecords.values(),
              });
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={!isChatMode && tab.id === activeTopicId}
                  className={`cockpit-topic-tab ${!isChatMode && tab.id === activeTopicId ? "cockpit-topic-tab--active" : ""}`}
                  onClick={() => handleSelectTopic(tab.id)}
                >
                  {t(tab.label)}
                  {unread ? (
                    <span
                      className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--cockpit-accent)] px-1 text-[9.5px] font-extrabold text-[#0e0e14]"
                      aria-label={t`Unread activity`}
                    >
                      1
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <CampaignChatsDropdown
            chats={chatThreads}
            activeChatId={isChatMode ? activeChatId : undefined}
            isCreating={isCreatingChat}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {threadId ? (
            <ConsultationDock
              threadId={threadId}
              onOpenThread={(childThreadId) => openThread(childThreadId)}
            />
          ) : null}
          {mediaPlanPrompts.length > 0 && props.onAnalyzeMediaPlan && props.identity ? (
            <div className="mb-4 space-y-2 rounded-xl border border-[var(--hairline)] bg-surface-secondary p-3">
              <p className="text-xs text-muted">
                <Trans>Media plan attachments detected in this thread.</Trans>
              </p>
              {mediaPlanPrompts.map((attachment) => (
                <div
                  key={`${attachment.recordId}:${attachment.path}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="inline-flex items-center gap-2 rounded-md border border-divider px-2.5 py-1.5 text-xs text-default-600">
                    <FileSpreadsheet className="size-3.5 text-success" aria-hidden />
                    {attachment.fileName}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[var(--cockpit-accent)]"
                    data-testid={`analyze-media-plan-${attachment.fileName}`}
                    onPress={() => {
                      void resolveCampaignAttachmentAbsolutePath({
                        projectId: props.projectId,
                        relativePath: attachment.path,
                      })
                        .then((filePath) =>
                          props.onAnalyzeMediaPlan?.({
                            filePath,
                            filename: attachment.fileName,
                            campaignGroupId: props.identity!.campaignGroupId,
                          }),
                        )
                        .catch(() => undefined);
                    }}
                  >
                    <Trans>Compare to published plan</Trans>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {!hasConsultations ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 text-muted">
              <p className="max-w-md text-center text-sm">
                <Trans>
                  Consultation results appear here. Use @codex, @verify, @panel, and other mentions
                  in the composer below.
                </Trans>
              </p>
            </div>
          ) : null}
        </div>

        <CampaignThreadComposer
          projectId={props.projectId}
          parentThreadId={threadId}
          campaignGroupId={props.identity?.campaignGroupId ?? ""}
          defaultProvider={defaultProvider}
          suggestedQuestions={props.suggestedQuestions ?? []}
          {...(props.onAnalyzeMediaPlan ? { onAnalyzeMediaPlan: props.onAnalyzeMediaPlan } : {})}
        />
      </div>
    </div>
  );
}
