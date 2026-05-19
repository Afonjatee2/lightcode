import { useState, type ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import { Monitor } from "lucide-react";
import type { AgentStatus, ThreadPresentationMode } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  getCommitGenCandidates,
  getCommitGenDefaultsHint,
  getConflictResolverCandidates,
  getConflictResolverDefaultsHint,
  getTitleGenCandidates,
  getTitleGenDefaultsHint,
  resolveCommitGenConfig,
  resolveTitleGenConfig,
  resolveConflictResolverConfig,
  sortByAutoPreference,
} from "@/renderer/components/providers";
import {
  EffortContextMenu,
  ProviderModelMenu,
  TuxIcon,
  type ProviderModelMenuProvider,
} from "@/renderer/components/common";

type EnvKind = "windows" | "wsl";
type Mode = "auto" | "custom" | "disabled";

function deriveMode(provider: string): Mode {
  if (provider === "auto") return "auto";
  if (provider === "disabled") return "disabled";
  return "custom";
}

function GenConfigSection(props: {
  heading: string;
  description: string;
  provider: string;
  model: string;
  effort: string;
  resolve: (
    agent: AgentStatus | undefined,
    model: string,
    effort: string,
  ) => { model: string; effort: string; availableEfforts: string[] };
  getCandidates: (statuses: AgentStatus[], provider: string) => AgentStatus[];
  allowDisabled?: boolean;
  defaultsHint?: string | undefined;
  agentStatuses: AgentStatus[];
  onConfigChange: (provider: string, model: string, effort: string) => void;
  /** Extra controls rendered below the model/effort toolbar (e.g. presentation mode picker). */
  extraControls?: ReactNode;
}) {
  const {
    heading,
    description,
    provider,
    model,
    effort,
    resolve,
    getCandidates,
    agentStatuses,
    onConfigChange,
  } = props;

  const installedAgents = agentStatuses.filter((a) => a.installed);
  const mode = deriveMode(provider);
  const customAgent =
    mode === "custom" ? installedAgents.find((a) => a.kind === provider) : undefined;
  // In Auto mode, ask the section's candidate helper so the toolbar mirrors the
  // runtime fallback chain — including the "skip provider without preferred model"
  // rule that's evaluated independently per section.
  const autoAgent = mode === "auto" ? getCandidates(agentStatuses, "auto")[0] : undefined;
  const displayAgent = customAgent ?? autoAgent;
  const displayResolved = displayAgent
    ? resolve(displayAgent, mode === "custom" ? model : "", mode === "custom" ? effort : "")
    : undefined;

  const providers: ProviderModelMenuProvider[] = installedAgents.map((a) => ({
    kind: a.kind,
    label: a.label,
    ...(a.icon ? { icon: a.icon } : {}),
    capabilities: a.capabilities,
  }));

  const efforts =
    displayResolved?.availableEfforts.map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    })) ?? [];

  function changeMode(next: Mode) {
    if (next === mode) return;
    if (next === "auto") {
      onConfigChange("auto", "", "");
      return;
    }
    if (next === "disabled") {
      onConfigChange("disabled", "", "");
      return;
    }
    const first = sortByAutoPreference(installedAgents)[0];
    if (!first) return;
    const r = resolve(first, "", "");
    onConfigChange(first.kind, r.model, r.effort);
  }

  function handleProviderModel(next: { agentKind: string; model: string }) {
    const nextAgent = installedAgents.find((a) => a.kind === next.agentKind);
    const r = resolve(nextAgent, next.model, effort);
    onConfigChange(next.agentKind, r.model, r.effort);
  }

  function handleEffort(value: string) {
    if (!customAgent || !displayResolved) return;
    onConfigChange(provider, displayResolved.model, value);
  }

  const showToolbar = (mode === "custom" || mode === "auto") && displayAgent && displayResolved;
  const isReadOnly = mode === "auto";

  const heading2 = props.defaultsHint ? (
    <Tooltip delay={300}>
      <Tooltip.Trigger tabIndex={-1} role="none">
        <h2 className="w-fit cursor-default text-sm font-semibold text-foreground">{heading}</h2>
      </Tooltip.Trigger>
      <Tooltip.Content className="text-xs">{props.defaultsHint}</Tooltip.Content>
    </Tooltip>
  ) : (
    <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
  );

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {heading2}
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {mode !== "disabled" && props.extraControls ? props.extraControls : null}
          <ToggleButtonGroup
            aria-label={`${heading} mode`}
            className="h-7 [&_button]:h-7 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:px-2"
            selectionMode="single"
            disallowEmptySelection
            size="sm"
            selectedKeys={[mode]}
            onSelectionChange={(keys) => {
              const next = [...keys][0] as Mode | undefined;
              if (next) changeMode(next);
            }}
          >
            <ToggleButton id="auto">Auto</ToggleButton>
            <ToggleButton id="custom" isDisabled={installedAgents.length === 0}>
              Custom
            </ToggleButton>
            {props.allowDisabled ? <ToggleButton id="disabled">Disabled</ToggleButton> : null}
          </ToggleButtonGroup>
        </div>
      </div>

      {showToolbar && displayAgent && displayResolved ? (
        <div className="lightcode-composer-toolbar flex flex-wrap items-center gap-1">
          <ProviderModelMenu
            providers={providers}
            currentAgentKind={displayAgent.kind}
            currentModel={displayResolved.model}
            isDisabled={isReadOnly}
            onChange={handleProviderModel}
          />
          {efforts.length > 0 ? (
            <EffortContextMenu
              efforts={efforts}
              effortValue={displayResolved.effort}
              isDisabled={isReadOnly}
              onEffortChange={handleEffort}
              contextSizes={[]}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PresentationModeToggle(props: {
  ariaLabel: string;
  value: ThreadPresentationMode;
  onChange: (value: ThreadPresentationMode) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={props.ariaLabel}
      className="h-7 [&_button]:h-7 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:px-2"
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      selectedKeys={[props.value]}
      onSelectionChange={(keys) => {
        const next = [...keys][0] as ThreadPresentationMode | undefined;
        if (next) props.onChange(next);
      }}
    >
      <ToggleButton id="gui">Chat</ToggleButton>
      <ToggleButton id="terminal">CLI</ToggleButton>
    </ToggleButtonGroup>
  );
}

export function AISettings() {
  const [envKind, setEnvKind] = useState<EnvKind>("windows");

  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const hasWsl = wslAgentStatuses.length > 0;
  const activeStatuses = envKind === "wsl" ? wslAgentStatuses : agentStatuses;

  const titleGenProvider = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslTitleGenProvider : s.titleGenProvider,
  );
  const titleGenModel = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslTitleGenModel : s.titleGenModel,
  );
  const titleGenEffort = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslTitleGenEffort : s.titleGenEffort,
  );
  const setTitleGenConfig = useSharedSettings((s) =>
    envKind === "wsl" ? s.setWslTitleGenConfig : s.setTitleGenConfig,
  );

  const commitGenProvider = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslCommitGenProvider : s.commitGenProvider,
  );
  const commitGenModel = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslCommitGenModel : s.commitGenModel,
  );
  const commitGenEffort = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslCommitGenEffort : s.commitGenEffort,
  );
  const setCommitGenConfig = useSharedSettings((s) =>
    envKind === "wsl" ? s.setWslCommitGenConfig : s.setCommitGenConfig,
  );

  const conflictResolverProvider = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslConflictResolverProvider : s.conflictResolverProvider,
  );
  const conflictResolverModel = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslConflictResolverModel : s.conflictResolverModel,
  );
  const conflictResolverEffort = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslConflictResolverEffort : s.conflictResolverEffort,
  );
  const setConflictResolverConfig = useSharedSettings((s) =>
    envKind === "wsl" ? s.setWslConflictResolverConfig : s.setConflictResolverConfig,
  );
  const conflictResolverPresentationMode = useSharedSettings((s) =>
    envKind === "wsl" ? s.wslConflictResolverPresentationMode : s.conflictResolverPresentationMode,
  );
  const setConflictResolverPresentationMode = useSharedSettings((s) =>
    envKind === "wsl"
      ? s.setWslConflictResolverPresentationMode
      : s.setConflictResolverPresentationMode,
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">AI</h1>
          {hasWsl ? (
            <ToggleButtonGroup
              aria-label="Environment"
              className="h-7 [&_button]:h-7 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:px-2"
              selectionMode="single"
              disallowEmptySelection
              size="sm"
              selectedKeys={[envKind]}
              onSelectionChange={(keys) => {
                const next = [...keys][0] as EnvKind | undefined;
                if (next) setEnvKind(next);
              }}
            >
              <ToggleButton isIconOnly id="windows" aria-label="Windows">
                <Monitor className="size-3.5" />
              </ToggleButton>
              <ToggleButton isIconOnly id="wsl" aria-label="WSL">
                <ToggleButtonGroup.Separator />
                <TuxIcon className="size-7" />
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}
        </div>

        <div className="space-y-8">
          <GenConfigSection
            heading="Title Generation"
            allowDisabled
            description="Generates short titles for new threads."
            defaultsHint={getTitleGenDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={titleGenProvider}
            model={titleGenModel}
            effort={titleGenEffort}
            resolve={resolveTitleGenConfig}
            getCandidates={getTitleGenCandidates}
            onConfigChange={setTitleGenConfig}
          />

          <GenConfigSection
            heading="Commit Message Generation"
            description="Generates commit messages from staged changes."
            defaultsHint={getCommitGenDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={commitGenProvider}
            model={commitGenModel}
            effort={commitGenEffort}
            resolve={resolveCommitGenConfig}
            getCandidates={getCommitGenCandidates}
            onConfigChange={setCommitGenConfig}
          />

          <GenConfigSection
            heading="Conflict Resolver"
            description="Resolves merge conflicts during rebase or merge."
            defaultsHint={getConflictResolverDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={conflictResolverProvider}
            model={conflictResolverModel}
            effort={conflictResolverEffort}
            resolve={resolveConflictResolverConfig}
            getCandidates={getConflictResolverCandidates}
            onConfigChange={setConflictResolverConfig}
            extraControls={
              <PresentationModeToggle
                ariaLabel="Open conflict resolver in"
                value={conflictResolverPresentationMode}
                onChange={setConflictResolverPresentationMode}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
