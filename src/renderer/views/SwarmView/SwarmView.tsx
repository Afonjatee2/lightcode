import { useEffect, useState } from "react";
import { toast } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Network, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { AgentStatus, PromptSegment, ThreadConfig } from "@/shared/contracts";
import {
  capabilitiesForPresentation,
  filterHiddenModels,
  modelSelectionFor,
} from "@/shared/agentSelection";
import { getProjectAgentStatuses } from "@/shared/agentStatus";
import { resolveUnrestrictedPermissionConfig } from "@/shared/agents/unrestrictedPermissions";
import { isHomeProject } from "@/shared/homeScope";
import {
  buildSwarmPrompt,
  type SwarmAgentSelection,
  type SwarmReviewSelection,
} from "@/shared/swarm";
import { makeThreadTitle } from "@/shared/threadTitle";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";
import { useAttachments } from "@/renderer/components/composer/useAttachments";
import { Button, Select } from "@/renderer/components/common";
import {
  ProviderModelMenu,
  type ProviderModelMenuProvider,
} from "@/renderer/components/common/ProviderModelMenu";
import { modelVisibilityKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { buildProviderModelMenuProviders } from "@/renderer/components/thread/buildModelPickerControls";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { SwarmTaskPanel } from "./SwarmTaskPanel";

const NONE = "__none__";
const MAX_WORKERS = 4;
const ORCHESTRATOR_PREFERENCES = ["gpt-5.6-sol", "claude-fable-5", "claude-opus-4-8"];
const WORKER_PREFERENCES = [
  ["qwen3.8-max-preview", "qwen 3.8 max"],
  ["glm-5.2", "glm 5.2"],
  ["k3", "kimi 3", "kimi-for-coding"],
  ["deepseek-v4-pro", "deepseek 4.0 pro"],
] as const;
const EFFORT_PREFERENCE = ["ultra", "max", "xhigh", "high", "medium", "low"];

interface ModelChoice extends SwarmAgentSelection {
  id: string;
  status: AgentStatus;
}

function choiceId(agentKind: string, model: string): string {
  return JSON.stringify([agentKind, model]);
}

function supportsGui(agent: AgentStatus): boolean {
  return (
    agent.capabilities.presentationMode === "gui" ||
    agent.capabilities.presentationModes?.includes("gui") === true
  );
}

function buildChoices(
  agents: readonly AgentStatus[],
  guiOnly: boolean,
  hiddenModels: Readonly<Record<string, readonly string[] | undefined>>,
): ModelChoice[] {
  return agents.flatMap((agent) => {
    if (guiOnly && !supportsGui(agent)) return [];
    const presentation = supportsGui(agent) ? "gui" : "terminal";
    const capabilities = filterHiddenModels(
      capabilitiesForPresentation(agent.capabilities, presentation),
      hiddenModels[modelVisibilityKey(agent.kind, presentation)],
    );
    return capabilities.models.map((model) => ({
      id: choiceId(agent.kind, model.id),
      agentKind: agent.kind,
      agentLabel: agent.label,
      model: model.id,
      modelLabel: model.label,
      status: agent,
    }));
  });
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function preferredChoice(
  choices: readonly ModelChoice[],
  preferences: readonly string[],
  excluded: ReadonlySet<string> = new Set(),
): ModelChoice | undefined {
  for (const preference of preferences) {
    const target = normalized(preference);
    const match = choices.find(
      (choice) =>
        !excluded.has(choice.id) &&
        (normalized(choice.model) === target ||
          normalized(choice.modelLabel) === target ||
          normalized(`${choice.agentLabel} ${choice.modelLabel}`).includes(target)),
    );
    if (match) return match;
  }
  return choices.find((choice) => !excluded.has(choice.id));
}

function strongestEffort(choice: ModelChoice): string | undefined {
  const presentation = supportsGui(choice.status) ? "gui" : "terminal";
  const capabilities = capabilitiesForPresentation(choice.status.capabilities, presentation);
  const values = modelSelectionFor(capabilities, choice.model).reasoning.values;
  return EFFORT_PREFERENCE.find((effort) => values.includes(effort)) ?? values.at(-1);
}

function SwarmModelPicker(props: {
  ariaLabel: string;
  providers: ProviderModelMenuProvider[];
  choice: ModelChoice | undefined;
  onChange: (id: string) => void;
  onClear?: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5" aria-label={props.ariaLabel}>
      <div className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] bg-surface-secondary/30 px-1 py-1">
        <ProviderModelMenu
          providers={props.providers}
          currentAgentKind={props.choice?.agentKind ?? ""}
          currentModel={props.choice?.model ?? ""}
          onChange={(next) => props.onChange(choiceId(next.agentKind, next.model))}
        />
      </div>
      {props.choice && props.onClear ? (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={props.removeLabel ?? props.ariaLabel}
          className="shrink-0 text-muted"
          onPress={props.onClear}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function SwarmView() {
  const { t } = useLingui();
  // Zustand's getSnapshot must return a referentially stable value. Subscribe
  // to the stored array, then derive the filtered list during render; returning
  // `filter(...)` directly from the selector causes an infinite store-update
  // loop before HeroUI can finish attaching Select collection refs.
  const allProjects = useAppStore((state) => state.projects);
  const projects = allProjects.filter((project) => !isHomeProject(project));
  const windowsAgents = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgents = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const windowsLoaded = useAgentStatusesStore((state) => state.windowsLoaded);
  const wslLoaded = useAgentStatusesStore((state) => state.wslLoaded);
  const disabledAgents = useSharedSettings((state) => state.disabledAgents);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const crossagentsDisabled = useSharedSettings(
    (state) => state.disabledBuiltInMcpServers.crossagents === true,
  );
  const enableCrossagents = useSharedSettings((state) => state.setBuiltInMcpServerDisabled);
  const [projectId, setProjectId] = useState("");
  const [task, setTask] = useState("");
  const [orchestratorId, setOrchestratorId] = useState("");
  const [reviewMode, setReviewMode] = useState<SwarmReviewSelection["mode"]>("root");
  const [reviewerId, setReviewerId] = useState("");
  const [workerCount, setWorkerCount] = useState(MAX_WORKERS);
  const [workerIds, setWorkerIds] = useState<string[]>(() =>
    Array.from({ length: MAX_WORKERS }, () => NONE),
  );
  const [initializedProjectId, setInitializedProjectId] = useState("");
  const attachments = useAttachments();

  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0];
  const projectAgents = project
    ? getProjectAgentStatuses(project.location, windowsAgents, wslAgents).filter(
        (agent) =>
          agent.installed &&
          agent.authState !== "missing" &&
          !disabledAgents.includes(agent.kind) &&
          agent.capabilities.models.length > 0,
      )
    : [];
  const orchestratorChoices = buildChoices(projectAgents, true, hiddenModels);
  const workerChoices = buildChoices(projectAgents, false, hiddenModels);
  const orchestratorProviders = buildProviderModelMenuProviders(projectAgents, {
    resolvePresentationMode: () => "gui",
    hiddenModelsByAgent: hiddenModels,
    filterAgent: supportsGui,
  }).filter((provider) => provider.capabilities.models.length > 0);
  const workerProviders = buildProviderModelMenuProviders(projectAgents, {
    resolvePresentationMode: (agent) => (supportsGui(agent) ? "gui" : "terminal"),
    hiddenModelsByAgent: hiddenModels,
  }).filter((provider) => provider.capabilities.models.length > 0);
  const firstProjectId = projects[0]?.id ?? "";
  const projectAgentsLoaded = project?.location.kind === "wsl" ? wslLoaded : windowsLoaded;

  useEffect(() => {
    if (!projectId && firstProjectId) setProjectId(firstProjectId);
  }, [firstProjectId, projectId]);

  useEffect(() => {
    if (!project || initializedProjectId === project.id) return;
    // Agent detection arrives asynchronously. Wait for a minimally usable
    // roster before choosing defaults, then leave later user choices alone.
    if (!projectAgentsLoaded || orchestratorChoices.length === 0 || workerChoices.length < 1)
      return;
    const availableOrchestrators = new Set(orchestratorChoices.map((choice) => choice.id));
    const defaultOrchestrator = preferredChoice(orchestratorChoices, ORCHESTRATOR_PREFERENCES)?.id;
    setOrchestratorId((current) =>
      availableOrchestrators.has(current) ? current : (defaultOrchestrator ?? ""),
    );
    setReviewerId((current) =>
      availableOrchestrators.has(current) ? current : (defaultOrchestrator ?? ""),
    );
    setWorkerCount((current) => Math.min(current, Math.max(1, workerChoices.length)));

    setWorkerIds((current) => {
      const available = new Set(workerChoices.map((choice) => choice.id));
      const used = new Set<string>();
      const next = WORKER_PREFERENCES.map((preferences, index) => {
        const existing = current[index];
        if (existing && existing !== NONE && available.has(existing) && !used.has(existing)) {
          used.add(existing);
          return existing;
        }
        const preferred = preferredChoice(workerChoices, preferences, used);
        if (!preferred) return NONE;
        used.add(preferred.id);
        return preferred.id;
      });
      return next.every((value, index) => value === current[index]) ? current : next;
    });
    setInitializedProjectId(project.id);
  }, [initializedProjectId, orchestratorChoices, project, projectAgentsLoaded, workerChoices]);

  const activeWorkerIds = workerIds.slice(0, workerCount);
  const selectedWorkers = activeWorkerIds.flatMap((id) => {
    const choice = workerChoices.find((candidate) => candidate.id === id);
    return choice ? [choice] : [];
  });
  const orchestrator = orchestratorChoices.find((choice) => choice.id === orchestratorId);
  const dedicatedReviewer = orchestratorChoices.find((choice) => choice.id === reviewerId);
  const reviewer = reviewMode === "root" ? orchestrator : dedicatedReviewer;
  const duplicateWorkers =
    new Set(selectedWorkers.map((choice) => choice.id)).size !== selectedWorkers.length;
  const canStart =
    Boolean(project && task.trim() && orchestrator && reviewer) &&
    selectedWorkers.length === workerCount &&
    !duplicateWorkers &&
    !crossagentsDisabled;

  function updateWorker(index: number, id: string) {
    setWorkerIds((current) => current.map((value, position) => (position === index ? id : value)));
  }

  function removeWorker(index: number) {
    if (workerCount <= 1) return;
    setWorkerIds((current) => [...current.slice(0, index), ...current.slice(index + 1), NONE]);
    setWorkerCount((current) => Math.max(1, current - 1));
  }

  function startSwarm() {
    if (!project || !task.trim()) {
      toast.warning(t`Describe the task before starting the swarm.`);
      return;
    }
    if (!orchestrator || !reviewer) {
      toast.warning(t`Choose an orchestrator and reviewer.`);
      return;
    }
    if (selectedWorkers.length !== workerCount) {
      toast.warning(t`Choose a model for every worker.`);
      return;
    }
    if (duplicateWorkers) {
      toast.warning(t`Choose a different model for each worker.`);
      return;
    }
    if (crossagentsDisabled) {
      toast.warning(t`Enable Crossagents before starting the swarm.`);
      return;
    }

    const capabilities = capabilitiesForPresentation(orchestrator.status.capabilities, "gui");
    const effort = strongestEffort(orchestrator);
    const config: ThreadConfig = {
      model: orchestrator.model,
      mode: "agent",
      crossagentMcp: true,
      ...resolveUnrestrictedPermissionConfig(capabilities),
      ...(effort ? { effort } : {}),
    };
    const prompt = buildSwarmPrompt({
      task,
      projectName: project.name,
      orchestrator,
      review: reviewMode === "root" ? { mode: "root" } : { mode: "dedicated", agent: reviewer },
      workers: selectedWorkers,
      attachmentCount: attachments.attachments.length,
    });
    const title = `${t`Swarm`} · ${makeThreadTitle(task)}`;
    const store = useAppStore.getState();
    const thread = store.createThread({
      projectId: project.id,
      agentKind: orchestrator.agentKind,
      config,
      prompt,
      title,
      presentationMode: "gui",
    });
    const attachmentSegments = attachments.toSegments();
    // Structured providers treat `segments` as the complete user message.
    // Keep the orchestration contract in the segment stream whenever files
    // are attached; otherwise the root receives only attachment chips and has
    // no task or instruction to launch workers.
    const launchSegments: PromptSegment[] | undefined =
      attachmentSegments.length > 0
        ? [{ kind: "text", content: prompt }, ...attachmentSegments]
        : undefined;
    store.queueThreadLaunch(thread.id, prompt, launchSegments);
    toast.success(t`Swarm started`);
  }

  async function attachTaskFiles() {
    try {
      const paths = await readBridge().pickFiles({
        title: t`Attach files`,
        attachmentThreadId: `swarm:${project?.id ?? "draft"}`,
      });
      if (paths) attachments.addFiles(paths);
    } catch (error) {
      toast.danger(friendlyError(error));
    }
  }

  if (projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <Network className="mx-auto mb-3 size-8 text-muted" />
          <h1 className="text-lg font-semibold">
            <Trans>Add a project to use Swarm</Trans>
          </h1>
          <p className="mt-2 text-sm text-muted">
            <Trans>Swarm creates isolated worktrees, so it needs a Git project first.</Trans>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header
        className={`poracode-content-over-drag-region ${macosTrafficLightPadClass} flex h-[env(titlebar-area-height,32px)] shrink-0 items-center border-b border-[var(--hairline)] px-3`}
      >
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2">
          <Network className="size-3.5 text-accent" />
          <span className="text-xs font-semibold">
            <Trans>Swarm</Trans>
          </span>
          <span className="text-[10px] text-muted">
            <Trans>Plan · Fan out · Review</Trans>
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 [scrollbar-gutter:stable]">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <section className="overflow-hidden rounded-2xl border border-[var(--hairline)] bg-surface-secondary/35">
            <div className="grid gap-px bg-[var(--hairline)] lg:grid-cols-[1.2fr_0.8fr]">
              <div className="bg-background p-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-accent" />
                  <h1 className="text-base font-semibold">
                    <Trans>Build with a coordinated agent team</Trans>
                  </h1>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  <Trans>
                    A strong root decomposes the task, launches workers in separate Git worktrees,
                    and reviews every diff. Nothing is merged automatically.
                  </Trans>
                </p>
              </div>
              <div className="bg-surface-secondary/50 p-5">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-muted">
                      <Trans>Workers</Trans>
                    </div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{workerCount}</div>
                  </div>
                  <div>
                    <div className="text-muted">
                      <Trans>Merge policy</Trans>
                    </div>
                    <div className="mt-1 font-medium">
                      <Trans>Manual only</Trans>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2 text-xs text-success">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  <Trans>Your existing checkout stays untouched by worker threads.</Trans>
                </div>
              </div>
            </div>
          </section>

          {crossagentsDisabled ? (
            <section className="flex items-center gap-3 rounded-xl border border-warning/35 bg-warning/5 px-4 py-3">
              <ShieldCheck className="size-4 shrink-0 text-warning" />
              <p className="min-w-0 flex-1 text-sm text-warning">
                <Trans>
                  Crossagents is disabled in Settings. Swarm needs it to launch workers.
                </Trans>
              </p>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => enableCrossagents("crossagents", false)}
              >
                <Trans>Enable Crossagents</Trans>
              </Button>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--hairline)] bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <Network className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">
                  <Trans>Control plane</Trans>
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  aria-label={t`Project`}
                  label={t`Project`}
                  options={projects.map((candidate) => ({
                    id: candidate.id,
                    label: candidate.name,
                  }))}
                  value={project?.id ?? null}
                  onChange={setProjectId}
                />
                <div>
                  <div className="mb-1 text-xs font-medium text-foreground">
                    <Trans>Orchestrator</Trans>
                  </div>
                  <SwarmModelPicker
                    ariaLabel={t`Orchestrator`}
                    providers={orchestratorProviders}
                    choice={orchestratorChoices.find((choice) => choice.id === orchestratorId)}
                    onChange={setOrchestratorId}
                  />
                </div>
                <div className="sm:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                    <Trans>Reviewer</Trans>
                    <div
                      role="group"
                      aria-label={t`Review mode`}
                      className="flex items-center rounded-md bg-surface-secondary p-0.5 font-normal"
                    >
                      <button
                        type="button"
                        aria-pressed={reviewMode === "root"}
                        className={`rounded px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                          reviewMode === "root"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted hover:text-foreground"
                        }`}
                        onClick={() => setReviewMode("root")}
                      >
                        <Trans>Orchestrator reviews</Trans>
                      </button>
                      <button
                        type="button"
                        aria-pressed={reviewMode === "dedicated"}
                        className={`rounded px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                          reviewMode === "dedicated"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted hover:text-foreground"
                        }`}
                        onClick={() => setReviewMode("dedicated")}
                      >
                        <Trans>Dedicated reviewer</Trans>
                      </button>
                    </div>
                  </div>
                  {reviewMode === "dedicated" ? (
                    <SwarmModelPicker
                      ariaLabel={t`Reviewer`}
                      providers={orchestratorProviders}
                      choice={dedicatedReviewer}
                      onChange={setReviewerId}
                    />
                  ) : (
                    <div className="flex h-11 items-center rounded-lg border border-[var(--hairline)] bg-surface-secondary/20 px-3 text-xs text-muted">
                      <Trans>The orchestrator performs the final review.</Trans>
                    </div>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted">
                <Trans>The root and reviewer use the strongest available reasoning tier.</Trans>
              </p>
            </div>

            <div className="rounded-xl border border-[var(--hairline)] bg-background p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="size-4 text-muted" />
                <h2 className="text-sm font-semibold">
                  <Trans>Worker pool</Trans>
                </h2>
                <div
                  role="group"
                  aria-label={t`Worker count`}
                  className="ml-auto flex items-center rounded-md bg-surface-secondary p-0.5"
                >
                  {Array.from({ length: MAX_WORKERS }, (_, index) => index + 1).map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-label={count === 1 ? t`Use 1 worker` : t`Use ${count} workers`}
                      aria-pressed={workerCount === count}
                      className={`flex size-6 items-center justify-center rounded text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        workerCount === count
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                      onClick={() => setWorkerCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
                <span>
                  <Plural
                    value={workerCount}
                    one="# implementation worker"
                    other="# implementation workers"
                  />
                </span>
                <span>
                  <Plural
                    value={selectedWorkers.length}
                    one="# model ready"
                    other="# models ready"
                  />
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {activeWorkerIds.map((workerId, index) => (
                  <div key={index} className="rounded-lg border border-[var(--hairline)] p-2.5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted">
                      <span className="flex size-5 items-center justify-center rounded-full bg-surface-secondary tabular-nums">
                        {index + 1}
                      </span>
                      <Trans>Worker</Trans>
                    </div>
                    <SwarmModelPicker
                      ariaLabel={t`Worker ${index + 1}`}
                      providers={workerProviders}
                      choice={workerChoices.find((choice) => choice.id === workerId)}
                      onChange={(value) => updateWorker(index, value)}
                      {...(workerCount > 1 ? { onClear: () => removeWorker(index) } : {})}
                      removeLabel={t`Remove`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <SwarmTaskPanel
            task={task}
            attachments={attachments.attachments}
            canStart={canStart}
            onTaskChange={setTask}
            onAttachFiles={attachTaskFiles}
            onRemoveAttachment={attachments.removeAttachment}
            onStart={startSwarm}
          />
        </main>
      </div>
    </div>
  );
}
