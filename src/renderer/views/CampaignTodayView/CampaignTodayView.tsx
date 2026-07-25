import { useEffect, useState, type KeyboardEvent } from "react";
import { Button, Spinner } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { OperationsTodayCampaignViewModel } from "@/renderer/adapters/campaignViewModels";
import { getProjectPurpose } from "@/shared/contracts/project";
import {
  findCampaignProjectByGroupId,
  diagnoseTodayControlCentreSetup,
  pickDefaultCampaignGroupId,
} from "@/renderer/campaign/resolveTodayDataSource";
import { ensureCampaignsHubProject } from "@/renderer/campaign/ensureCampaignsHubProject";
import { controlCentreUnavailableMessage } from "@/renderer/campaign/controlCentreAvailabilityCopy";
import {
  dayPeriodGreeting,
  greetingAllClear,
  resolveDayPeriod,
} from "@/renderer/campaign/cockpit/cockpitGreeting";
import { generateMorningBrief } from "@/renderer/campaign/morningBrief/briefGenerator";
import { useMorningBriefStore } from "@/renderer/campaign/morningBrief/morningBriefStore";
import { processMorningBriefNotifications } from "@/renderer/campaign/morningBrief/morningBriefSync";
import { useCampaignTodayOperations } from "@/renderer/hooks/useCampaignTodayOperations";
import { useProfileDisplayName } from "@/renderer/hooks/useProfileDisplayName";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";
import { MorningBriefCard } from "./parts/MorningBriefCard";

const ASK_SUGGESTIONS = [
  msg`Which campaigns are off pace this week?`,
  msg`Any sources stale right now?`,
  msg`Summarize what needs approval today`,
] as const;

function prioritySeverity(priority?: "P1" | "P2" | "P3" | "P4"): "crit" | "warn" | "info" {
  if (priority === "P1") return "crit";
  if (priority === "P2") return "warn";
  return "info";
}

function SeverityBadge(props: { priority?: "P1" | "P2" | "P3" | "P4" }) {
  const { t } = useLingui();
  const severity = prioritySeverity(props.priority);
  const label =
    severity === "crit"
      ? t`Critical`
      : severity === "warn"
        ? t`Warning`
        : (props.priority ?? t`Info`);
  const tone =
    severity === "crit"
      ? "bg-danger/15 text-danger"
      : severity === "warn"
        ? "bg-warning/15 text-warning"
        : "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function AttentionRow(props: {
  campaign: OperationsTodayCampaignViewModel;
  onOpen: (campaignGroupId: string) => void;
}) {
  const severity = prioritySeverity(props.campaign.topPriority);
  const summary = props.campaign.attentionReason ?? props.campaign.campaignName;
  const project = useAppStore((state) =>
    findCampaignProjectByGroupId(state.projects, props.campaign.campaignGroupId),
  );
  const iconTone =
    severity === "crit"
      ? "bg-danger/15 text-danger"
      : severity === "warn"
        ? "bg-warning/15 text-warning"
        : "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]";

  const body = (
    <>
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
        aria-hidden
      >
        {severity === "crit" ? (
          <AlertTriangle className="size-4" />
        ) : severity === "warn" ? (
          <TrendingUp className="size-4" />
        ) : (
          <Sparkles className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {props.campaign.clientName} · {props.campaign.campaignName}
          </span>
          <SeverityBadge
            {...(props.campaign.topPriority ? { priority: props.campaign.topPriority } : {})}
          />
        </div>
        <p className="truncate text-sm font-semibold text-foreground">{summary}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </>
  );

  if (!project) {
    return (
      <div
        className={`cockpit-alert-row cockpit-alert-row--${severity} flex items-center gap-3.5 px-4 py-3 opacity-70`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`cockpit-alert-row cockpit-alert-row--${severity} flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-[var(--row-hover)]`}
      onClick={() => props.onOpen(props.campaign.campaignGroupId)}
    >
      {body}
    </button>
  );
}

function ApprovalRow(props: {
  campaign: OperationsTodayCampaignViewModel;
  onOpen: (campaignGroupId: string) => void;
}) {
  const { t } = useLingui();
  const project = useAppStore((state) =>
    findCampaignProjectByGroupId(state.projects, props.campaign.campaignGroupId),
  );
  const summary =
    props.campaign.attentionReason ??
    t`${props.campaign.pendingProposalCount} proposals awaiting approval`;

  const body = (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]">
        <ClipboardList className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {props.campaign.clientName} · {props.campaign.campaignName}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">{summary}</p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-[var(--cockpit-accent)]">
        <Trans>Review</Trans>
        <ArrowRight className="ml-0.5 inline size-3.5" aria-hidden />
      </span>
    </>
  );

  if (!project) {
    return (
      <div className="cockpit-approval-row flex items-center gap-3.5 px-4 py-3 opacity-70">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="cockpit-approval-row flex w-full items-center gap-3.5 px-4 py-3 text-left"
      onClick={() => props.onOpen(props.campaign.campaignGroupId)}
    >
      {body}
    </button>
  );
}

function LiveCampaignRow(props: {
  campaign: OperationsTodayCampaignViewModel;
  onOpen: (campaignGroupId: string) => void;
}) {
  const project = useAppStore((state) =>
    findCampaignProjectByGroupId(state.projects, props.campaign.campaignGroupId),
  );
  const label = `${props.campaign.clientName} — ${props.campaign.campaignName}`;

  if (!project) {
    return (
      <div className="flex items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted opacity-70">
        <span className="size-2 rounded-full bg-success shadow-[0_0_8px_color-mix(in_oklab,var(--success)_50%,transparent)]" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
      onClick={() => props.onOpen(props.campaign.campaignGroupId)}
    >
      <span className="size-2 shrink-0 rounded-full bg-success shadow-[0_0_8px_color-mix(in_oklab,var(--success)_50%,transparent)]" />
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[11px] text-muted">
        {props.campaign.deliveryState}
      </span>
    </button>
  );
}

function BucketHead(props: {
  title: string;
  count?: number;
  hint?: string;
  countTone?: "danger" | "accent" | "success" | "muted";
}) {
  const countClass =
    props.countTone === "danger"
      ? "bg-danger/15 text-danger"
      : props.countTone === "accent"
        ? "bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]"
        : props.countTone === "success"
          ? "bg-success/15 text-success"
          : "bg-[var(--row-hover)] text-muted";

  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <h2 className="text-[15px] font-bold tracking-tight text-foreground">{props.title}</h2>
      {props.count !== undefined ? (
        <span
          className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${countClass}`}
        >
          {props.count}
        </span>
      ) : null}
      {props.hint ? <span className="ml-auto text-[11.5px] text-muted">{props.hint}</span> : null}
    </div>
  );
}

function SourceHealthChips(props: { healthy: number; stale: number; failed: number }) {
  const { t } = useLingui();
  return (
    <div className="flex flex-wrap gap-2">
      {props.healthy > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
          <span className="size-1.5 rounded-full bg-success" />
          {t`${props.healthy} healthy`}
        </span>
      ) : null}
      {props.stale > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
          <span className="size-1.5 rounded-full bg-warning" />
          {t`${props.stale} stale`}
        </span>
      ) : null}
      {props.failed > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger/10 px-3 py-1 text-xs font-semibold text-danger">
          <span className="size-1.5 rounded-full bg-danger" />
          {t`${props.failed} failed`}
        </span>
      ) : null}
    </div>
  );
}

export function CampaignTodayView() {
  const { t } = useLingui();
  const displayName = useProfileDisplayName();
  const [askText, setAskText] = useState("");
  const projects = useAppStore((state) => state.projects);
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const { projectId, globalControlCentreReady, operationsToday } = useCampaignTodayOperations();
  const openDraft = useAppStore((state) => state.openDraft);
  const setPendingCampaignComposerPrefill = useAppStore(
    (state) => state.setPendingCampaignComposerPrefill,
  );
  const setPendingCampaignApprovalsFocus = useAppStore(
    (state) => state.setPendingCampaignApprovalsFocus,
  );
  const setPendingCampaignWorkspaceSelection = useAppStore(
    (state) => state.setPendingCampaignWorkspaceSelection,
  );
  const hasCampaignProjects = projects.some((project) => getProjectPurpose(project) === "campaign");
  const showNoProjectsSetupState = !hasCampaignProjects;
  const showNoControlCentreSetupState =
    hasCampaignProjects && !projectId && !globalControlCentreReady;
  const canAskAnything = Boolean(projectId || globalControlCentreReady);
  const controlCentreSetupReason = showNoControlCentreSetupState
    ? diagnoseTodayControlCentreSetup(projects, userMcpServers)
    : null;

  const morningBriefEnabled = useSharedSettings((s) => s.morningBriefEnabled);
  const latestBrief = useMorningBriefStore((s) => s.latestBrief);
  const setLatestBrief = useMorningBriefStore((s) => s.setLatestBrief);
  const dismissedAt = useMorningBriefStore((s) => s.dismissedAt);
  const dismissBrief = useMorningBriefStore((s) => s.dismissBrief);

  const generatedAt = operationsToday.status === "ready" ? operationsToday.data.generatedAt : null;

  useEffect(() => {
    if (operationsToday.status !== "ready") return;
    const currentBrief = useMorningBriefStore.getState().latestBrief;
    if (currentBrief && currentBrief.generatedAt === operationsToday.data.generatedAt) {
      return;
    }
    const brief = generateMorningBrief(operationsToday.data);
    setLatestBrief(brief);
    if (morningBriefEnabled) {
      processMorningBriefNotifications(brief);
    }
  }, [operationsToday, morningBriefEnabled, setLatestBrief, generatedAt]);

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

  async function handleAskSubmit() {
    const text = askText.trim();
    if (!text || !canAskAnything) return;

    let targetProjectId = projectId;
    if (!targetProjectId) {
      const hub = await ensureCampaignsHubProject();
      if (!hub.ok) return;
      targetProjectId = hub.projectId;
      const defaultCampaignGroupId =
        operationsToday.status === "ready"
          ? pickDefaultCampaignGroupId(operationsToday.data)
          : undefined;
      if (defaultCampaignGroupId) {
        setPendingCampaignWorkspaceSelection({
          projectId: targetProjectId,
          campaignGroupId: defaultCampaignGroupId,
        });
      }
    }

    setPendingCampaignComposerPrefill({ projectId: targetProjectId, text });
    openDraft(targetProjectId);
    setAskText("");
  }

  function handleAskKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleAskSubmit();
    }
  }

  const needsYouCount =
    operationsToday.status === "ready"
      ? operationsToday.data.counts.needsAttention + operationsToday.data.counts.waitingForApproval
      : 0;

  const period = resolveDayPeriod(new Date());
  const greetingPrefix = t(dayPeriodGreeting(period));

  function renderHeadline() {
    if (operationsToday.status !== "ready") {
      return (
        <h1 className="text-[26px] font-bold tracking-tight text-foreground">
          <Trans>Today</Trans>
        </h1>
      );
    }

    if (needsYouCount === 0) {
      return (
        <h1 className="text-[26px] font-bold tracking-tight text-foreground">
          {greetingPrefix}
          {displayName ? `, ${displayName}` : ""} —{" "}
          <span className="text-success">{t(greetingAllClear)}</span>
        </h1>
      );
    }

    return (
      <h1 className="text-[26px] font-bold tracking-tight text-foreground">
        {greetingPrefix}
        {displayName ? `, ${displayName}` : ""} —{" "}
        <span className="text-warning">
          <Plural value={needsYouCount} one="# thing needs you." other="# things need you." />
        </span>
      </h1>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 py-8 [scrollbar-gutter:stable]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7">
        <header>
          {renderHeadline()}
          {operationsToday.status === "ready" ? (
            <p className="mt-1 text-xs text-muted">
              <Trans>Operations brief</Trans> · <Trans>Generated</Trans>{" "}
              <RelativeTime iso={operationsToday.data.generatedAt} /> ·{" "}
              <Plural
                value={operationsToday.data.counts.total}
                one="# live campaign"
                other="# live campaigns"
              />{" "}
              · <span className="font-mono text-[11px]">Control Centre</span>
            </p>
          ) : null}
        </header>

        {morningBriefEnabled &&
        latestBrief &&
        (!dismissedAt || Date.parse(dismissedAt) < Date.parse(latestBrief.generatedAt)) ? (
          <MorningBriefCard
            brief={latestBrief}
            onDismiss={dismissBrief}
            onOpenCampaign={openCampaignWorkspace}
          />
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="cockpit-askbar flex items-center gap-3 px-4 py-3.5">
            <Sparkles className="size-[18px] shrink-0 text-[var(--cockpit-accent)]" aria-hidden />
            <textarea
              aria-label={t`Ask anything about your campaigns`}
              placeholder={t`Ask anything across your campaigns — grounded in Control Centre data…`}
              value={askText}
              onChange={(event) => setAskText(event.target.value)}
              onKeyDown={handleAskKeyDown}
              rows={1}
              disabled={!canAskAnything}
              className="max-h-24 min-h-[24px] flex-1 resize-none border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted disabled:opacity-50"
            />
            <Button
              isIconOnly
              size="sm"
              variant="primary"
              className="shrink-0 bg-[var(--cockpit-accent)] text-[#0e0e14]"
              isDisabled={!canAskAnything || askText.trim().length === 0}
              aria-label={t`Ask`}
              onPress={() => {
                void handleAskSubmit();
              }}
            >
              <Send className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ASK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="cockpit-chip"
                disabled={!canAskAnything}
                onClick={() => setAskText(t(suggestion))}
              >
                {t(suggestion)}
              </button>
            ))}
          </div>
        </section>

        {showNoProjectsSetupState ? (
          <section className="rounded-2xl border border-[var(--hairline)] px-4 py-6 text-center">
            <p className="text-sm text-muted">
              <Trans>
                Ask questions above anytime Control Centre is connected. Pin a campaign workspace
                here when you want a dedicated folder for one campaign.
              </Trans>
            </p>
            <Button
              className="mt-4 bg-[var(--cockpit-accent)] text-[#0e0e14]"
              variant="primary"
              size="sm"
              onPress={() => usePanelStore.getState().openCreateCampaignProjectModal()}
            >
              <Trans>Pin campaign workspace</Trans>
            </Button>
          </section>
        ) : null}

        {showNoControlCentreSetupState ? (
          <section className="rounded-2xl border border-[var(--hairline)] px-4 py-6 text-center">
            <p className="text-sm text-muted">
              {t(controlCentreUnavailableMessage(controlCentreSetupReason ?? "not-configured"))}
            </p>
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
            <Trans>Control Centre needs authorization. Reconnect it in settings.</Trans>
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
              <section>
                <BucketHead
                  title={t`Needs attention`}
                  count={operationsToday.data.counts.needsAttention}
                  countTone="danger"
                  hint={t`Sorted by severity · click through to the campaign thread`}
                />
                <div className="flex flex-col gap-2">
                  {operationsToday.data.needsAttention.map((campaign) => (
                    <AttentionRow
                      key={campaign.campaignGroupId}
                      campaign={campaign}
                      onOpen={openCampaignWorkspace}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {operationsToday.data.waitingForApproval.length > 0 ? (
              <section>
                <BucketHead
                  title={t`Waiting for approval`}
                  count={operationsToday.data.counts.waitingForApproval}
                  countTone="accent"
                  hint={t`Only you can approve — nothing executes without it`}
                />
                <div className="flex flex-col gap-2">
                  {operationsToday.data.waitingForApproval.map((campaign) => (
                    <ApprovalRow
                      key={campaign.campaignGroupId}
                      campaign={campaign}
                      onOpen={(id) => openCampaignWorkspace(id, { openApprovals: true })}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <div className="grid gap-6 md:grid-cols-2">
              <section>
                <BucketHead
                  title={t`All other live campaigns`}
                  count={operationsToday.data.healthyCampaignCount}
                  countTone="success"
                />
                {operationsToday.data.otherLive.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {operationsToday.data.otherLive.map((campaign) => (
                      <LiveCampaignRow
                        key={campaign.campaignGroupId}
                        campaign={campaign}
                        onOpen={openCampaignWorkspace}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--hairline)] px-6 py-8 text-center">
                    <Sparkles className="size-5 text-muted" aria-hidden />
                    <p className="text-sm text-muted">
                      <Trans>No other live campaigns.</Trans>
                    </p>
                  </div>
                )}
              </section>

              <div className="flex flex-col gap-6">
                {operationsToday.data.recentlyResolved.length > 0 ? (
                  <section>
                    <BucketHead
                      title={t`Recently resolved`}
                      count={operationsToday.data.recentlyResolved.length}
                    />
                    <div className="flex flex-col gap-2">
                      {operationsToday.data.recentlyResolved.map((entry) => (
                        <div
                          key={`${entry.campaignGroupId}:${entry.alertId}`}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted"
                        >
                          <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {entry.name}
                          </span>
                          <RelativeTime iso={entry.resolvedAt} className="shrink-0 text-[11px]" />
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <BucketHead title={t`Source health`} />
                  <div className="rounded-xl border border-[var(--hairline)] bg-surface px-4 py-3.5">
                    <SourceHealthChips {...operationsToday.data.sourceHealthSummary} />
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
