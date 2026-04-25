import { useState } from "react";
import { ToggleButton, ToggleButtonGroup, Tooltip } from "@heroui/react";
import { Monitor } from "lucide-react";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  getCommitGenDefaultsHint,
  getConflictResolverDefaultsHint,
  getTitleGenDefaultsHint,
  resolveCommitGenConfig,
  resolveTitleGenConfig,
  resolveConflictResolverConfig,
} from "@/renderer/components/providers";
import { Select, TuxIcon } from "@/renderer/components/common";

function GenConfigSection(props: {
  heading: string;
  providerLabel: string;
  modelLabel: string;
  effortLabel: string;
  provider: string;
  model: string;
  effort: string;
  resolve: (
    agent: AgentStatus | undefined,
    model: string,
    effort: string,
  ) => { model: string; effort: string; availableEfforts: string[] };
  allowDisabled?: boolean;
  defaultsHint?: string | undefined;
  agentStatuses: AgentStatus[];
  onConfigChange: (provider: string, model: string, effort: string) => void;
}) {
  const {
    heading,
    providerLabel,
    modelLabel,
    effortLabel,
    provider,
    model,
    effort,
    resolve,
    onConfigChange,
  } = props;
  const agentStatuses = props.agentStatuses;
  const installedAgents = agentStatuses.filter((a) => a.installed);
  const isDisabled = provider === "disabled";
  const selectedAgent =
    provider !== "auto" && !isDisabled
      ? installedAgents.find((a) => a.kind === provider)
      : undefined;
  const resolved = resolve(selectedAgent, model, effort);

  const providerOptions = [
    ...(props.allowDisabled ? [{ id: "disabled", label: "Disabled" }] : []),
    { id: "auto", label: "Auto (Recommended)" },
    ...installedAgents.map((a) => ({ id: a.kind, label: a.label })),
  ];

  const modelOptions = selectedAgent ? [...selectedAgent.capabilities.models] : [];

  const effortOptions = selectedAgent
    ? resolved.availableEfforts.map((id) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
      }))
    : [];

  return (
    <div className="space-y-4">
      {props.defaultsHint ? (
        <Tooltip delay={300}>
          <Tooltip.Trigger tabIndex={-1} role="none">
            <h2 className="w-fit cursor-default text-sm font-semibold text-muted">{heading}</h2>
          </Tooltip.Trigger>
          <Tooltip.Content className="text-xs">{props.defaultsHint}</Tooltip.Content>
        </Tooltip>
      ) : (
        <h2 className="text-sm font-semibold text-muted">{heading}</h2>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Provider</p>
          <p className="text-xs text-muted">{providerLabel}</p>
        </div>
        <Select
          aria-label="Provider"
          className="w-[200px] shrink-0"
          options={providerOptions}
          value={provider}
          onChange={(value) => {
            if (value === "auto" || value === "disabled") {
              onConfigChange(value, "", "");
            } else {
              const agent = installedAgents.find((a) => a.kind === value);
              const next = resolve(agent, "", "");
              onConfigChange(value, next.model, next.effort);
            }
          }}
        />
      </div>

      {selectedAgent && modelOptions.length > 0 ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Model</p>
            <p className="text-xs text-muted">{modelLabel}</p>
          </div>
          <Select
            aria-label="Model"
            className="w-[200px] shrink-0"
            options={modelOptions}
            value={resolved.model}
            onChange={(value) => {
              const next = resolve(selectedAgent, value, effort);
              onConfigChange(provider, next.model, next.effort);
            }}
          />
        </div>
      ) : null}

      {selectedAgent && effortOptions.length > 0 ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Effort</p>
            <p className="text-xs text-muted">{effortLabel}</p>
          </div>
          <Select
            aria-label="Effort"
            className="w-[200px] shrink-0"
            options={effortOptions}
            value={resolved.effort}
            onChange={(value) => onConfigChange(provider, resolved.model, value)}
          />
        </div>
      ) : null}
    </div>
  );
}

type EnvKind = "windows" | "wsl";

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

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
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
            providerLabel="Agent used to generate thread titles."
            modelLabel="Model for title generation."
            effortLabel="Reasoning effort for generation."
            defaultsHint={getTitleGenDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={titleGenProvider}
            model={titleGenModel}
            effort={titleGenEffort}
            resolve={resolveTitleGenConfig}
            onConfigChange={setTitleGenConfig}
          />

          <GenConfigSection
            heading="Commit Message Generation"
            providerLabel="Agent used to generate commit messages."
            modelLabel="Model for commit message generation."
            effortLabel="Reasoning effort for generation."
            defaultsHint={getCommitGenDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={commitGenProvider}
            model={commitGenModel}
            effort={commitGenEffort}
            resolve={resolveCommitGenConfig}
            onConfigChange={setCommitGenConfig}
          />

          <GenConfigSection
            heading="Conflict Resolver"
            providerLabel="Agent used to resolve merge conflicts."
            modelLabel="Model for conflict resolution."
            effortLabel="Reasoning effort for resolution."
            defaultsHint={getConflictResolverDefaultsHint()}
            agentStatuses={activeStatuses}
            provider={conflictResolverProvider}
            model={conflictResolverModel}
            effort={conflictResolverEffort}
            resolve={resolveConflictResolverConfig}
            onConfigChange={setConflictResolverConfig}
          />
        </div>
      </div>
    </div>
  );
}
