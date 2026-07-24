import { useState, type KeyboardEvent } from "react";
import { Button, Spinner, TextArea } from "@heroui/react";
import { Send } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { OperationsTodayCampaignViewModel } from "@/renderer/adapters/campaignViewModels";
import { findCampaignProjectByGroupId } from "@/renderer/campaign/resolveTodayDataSource";
import { useCampaignTodayOperations } from "@/renderer/hooks/useCampaignTodayOperations";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";

function CampaignRow(props: {
  campaign: OperationsTodayCampaignViewModel;
  onOpen: (campaignGroupId: string) => void;
  showPriority?: boolean;
}) {
  const project = useAppStore((state) =>
    findCampaignProjectByGroupId(state.projects, props.campaign.campaignGroupId),
  );
  const summary = props.campaign.attentionReason ?? props.campaign.campaignName;
  const body = (
    <>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {props.campaign.clientName} — {props.campaign.campaignName}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{summary}</p>
        </div>
        {props.showPriority && props.campaign.topPriority ? (
          <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">
            {props.campaign.topPriority}
          </span>
        ) : null}
      </div>
    </>
  );

  if (!project) {
    return (
      <div className="rounded-2xl px-3 py-2 text-left opacity-70" aria-disabled>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="w-full rounded-2xl px-3 py-2 text-left transition-colors hover:bg-[var(--row-hover)]"
      onClick={() => props.onOpen(props.campaign.campaignGroupId)}
    >
      {body}
    </button>
  );
}

function BucketSection(props: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {props.title}
        {props.count !== undefined ? ` (${props.count})` : ""}
      </h2>
      <div className="flex flex-col gap-1">{props.children}</div>
    </section>
  );
}

export function CampaignTodayView() {
  const { t } = useLingui();
  const [askText, setAskText] = useState("");
  const projects = useAppStore((state) => state.projects);
  const { projectId, operationsToday } = useCampaignTodayOperations();
  const openDraft = useAppStore((state) => state.openDraft);
  const setPendingCampaignComposerPrefill = useAppStore(
    (state) => state.setPendingCampaignComposerPrefill,
  );
  const setPendingCampaignApprovalsFocus = useAppStore(
    (state) => state.setPendingCampaignApprovalsFocus,
  );
  const showSetupState = !projectId;

  function sourceHealthLabel(summary: { healthy: number; stale: number; failed: number }) {
    const parts: string[] = [];
    if (summary.healthy > 0) parts.push(t`${summary.healthy} healthy`);
    if (summary.stale > 0) parts.push(t`${summary.stale} stale`);
    if (summary.failed > 0) parts.push(t`${summary.failed} failed`);
    return parts.length > 0 ? parts.join(", ") : "—";
  }

  function openCampaignWorkspace(campaignGroupId: string, options?: { openApprovals?: boolean }) {
    const project = findCampaignProjectByGroupId(projects, campaignGroupId);
    if (!project) return;
    if (options?.openApprovals) {
      setPendingCampaignApprovalsFocus({
        projectId: project.id,
        campaignGroupId,
      });
    }
    openDraft(project.id);
  }

  function handleAskSubmit() {
    const text = askText.trim();
    if (!text || !projectId) return;
    setPendingCampaignComposerPrefill({ projectId, text });
    openDraft(projectId);
    setAskText("");
  }

  function handleAskKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleAskSubmit();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 py-8 [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8">
        <header>
          <h1 className="text-lg font-semibold text-foreground">
            <Trans>Today</Trans>
          </h1>
        </header>

        <section className="flex flex-col gap-2">
          <TextArea
            aria-label={t`Ask anything about your campaigns`}
            placeholder={t`Ask anything about your campaigns…`}
            value={askText}
            onChange={(event) => setAskText(event.target.value)}
            onKeyDown={handleAskKeyDown}
            rows={3}
            disabled={!projectId}
            className="w-full"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              isDisabled={!projectId || askText.trim().length === 0}
              onPress={handleAskSubmit}
            >
              <Send className="size-4" />
              {t`Ask`}
            </Button>
          </div>
        </section>

        {showSetupState ? (
          <section className="rounded-2xl border border-[var(--hairline)] px-4 py-6 text-center">
            <p className="text-sm text-muted">
              <Trans>Create a campaign project to see your operations overview.</Trans>
            </p>
            <Button
              className="mt-4"
              variant="primary"
              size="sm"
              onPress={() => usePanelStore.getState().openCreateCampaignProjectModal()}
            >
              <Trans>New Campaign Project</Trans>
            </Button>
          </section>
        ) : null}

        {operationsToday.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            <Trans>Loading operations overview…</Trans>
          </div>
        ) : null}

        {operationsToday.status === "unauthorized" ? (
          <p className="text-sm text-muted">
            <Trans>Control Centre needs authorization. Reconnect it in MCP settings.</Trans>
          </p>
        ) : null}

        {operationsToday.status === "unavailable" ? (
          <p className="text-sm text-muted">{operationsToday.message}</p>
        ) : null}

        {operationsToday.status === "error" ? (
          <p className="text-sm text-danger">{operationsToday.message}</p>
        ) : null}

        {operationsToday.status === "ready" ? (
          <>
            {operationsToday.data.needsAttention.length > 0 ? (
              <BucketSection
                title={t`Needs attention`}
                count={operationsToday.data.counts.needsAttention}
              >
                {operationsToday.data.needsAttention.map((campaign) => (
                  <CampaignRow
                    key={campaign.campaignGroupId}
                    campaign={campaign}
                    showPriority
                    onOpen={openCampaignWorkspace}
                  />
                ))}
              </BucketSection>
            ) : null}

            {operationsToday.data.waitingForApproval.length > 0 ? (
              <BucketSection
                title={t`Waiting for approval`}
                count={operationsToday.data.counts.waitingForApproval}
              >
                {operationsToday.data.waitingForApproval.map((campaign) => (
                  <CampaignRow
                    key={campaign.campaignGroupId}
                    campaign={campaign}
                    onOpen={(campaignGroupId) =>
                      openCampaignWorkspace(campaignGroupId, { openApprovals: true })
                    }
                  />
                ))}
              </BucketSection>
            ) : null}

            <BucketSection
              title={t`All other live campaigns`}
              count={operationsToday.data.healthyCampaignCount}
            >
              {operationsToday.data.otherLive.length > 0 ? (
                operationsToday.data.otherLive.map((campaign) => (
                  <CampaignRow
                    key={campaign.campaignGroupId}
                    campaign={campaign}
                    onOpen={openCampaignWorkspace}
                  />
                ))
              ) : (
                <p className="px-3 py-2 text-sm text-muted">
                  <Trans>No other live campaigns.</Trans>
                </p>
              )}
            </BucketSection>

            {operationsToday.data.recentlyResolved.length > 0 ? (
              <BucketSection title={t`Recently resolved`}>
                {operationsToday.data.recentlyResolved.map((entry) => (
                  <div key={`${entry.campaignGroupId}:${entry.alertId}`} className="px-3 py-2">
                    <p className="text-sm font-medium text-foreground">{entry.name}</p>
                    <p className="text-xs text-muted">
                      <RelativeTime iso={entry.resolvedAt} />
                    </p>
                  </div>
                ))}
              </BucketSection>
            ) : null}

            <footer className="border-t border-[var(--hairline)] pt-4 text-xs text-muted">
              <p>
                <Trans>Source health:</Trans>{" "}
                {sourceHealthLabel(operationsToday.data.sourceHealthSummary)}
              </p>
              <p className="mt-1">
                <Trans>Generated</Trans> <RelativeTime iso={operationsToday.data.generatedAt} />
              </p>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}
