import { Tooltip } from "@heroui/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { FlaskConical, Plus, Sparkles, X } from "lucide-react";
import type { ExperimentCandidateSpec } from "@/renderer/actions/experimentActions";
import { MAX_EXPERIMENT_FALLBACK_CHAIN } from "@/shared/contracts";
import type { AgentStatus } from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import {
  ThreadDockActionRow,
  ThreadDockHeader,
  ThreadDockList,
  ThreadDockSection,
} from "@/renderer/components/thread/ThreadDockUI";
import { formatEffortLabel } from "@/renderer/components/thread/threadDraftViewHelpers";

export interface ExperimentDraftCandidate extends ExperimentCandidateSpec {
  id: string;
  icon?: string;
  modelLabel: string;
}

export function ExperimentDraftTargets(props: {
  candidates: readonly ExperimentDraftCandidate[];
  eligibleFallbackAgents: readonly AgentStatus[];
  isSubmitting: boolean;
  isAddDisabled: boolean;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onAdd: () => void;
  onFallbackChange: (candidateId: string, fallbackChain: string[]) => void;
  /** When provided, shows a "Draft spec" button that opens the orchestrator dialog. */
  onDraftSpec?: () => void;
  isDraftSpecDisabled?: boolean;
}) {
  const { t } = useLingui();

  return (
    <ThreadDockSection ariaLabel={t`Experiment`} placement="composer">
      <ThreadDockHeader
        icon={FlaskConical}
        title={t`Experiment`}
        countLabel={
          <Plural value={props.candidates.length} one="# candidate" other="# candidates" />
        }
        actions={
          <div className="flex items-center gap-0.5">
            {props.onDraftSpec ? (
              <Tooltip delay={0}>
                <Tooltip.Trigger>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted"
                    aria-label={t`Draft spec`}
                    isDisabled={props.isDraftSpecDisabled ?? false}
                    onPress={props.onDraftSpec}
                  >
                    <Sparkles className="size-3.5" />
                    <Trans>Draft spec</Trans>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <Trans>Draft spec from a task</Trans>
                </Tooltip.Content>
              </Tooltip>
            ) : null}
            <Tooltip delay={0}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-0 shrink-0 text-muted"
                  aria-label={t`Add candidate`}
                  isDisabled={props.isAddDisabled}
                  onPress={props.onAdd}
                >
                  <Plus className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <Trans>Add candidate</Trans>
              </Tooltip.Content>
            </Tooltip>
            <Tooltip delay={0}>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-0 shrink-0 text-muted"
                  aria-label={t`Cancel`}
                  isDisabled={props.isSubmitting}
                  onPress={props.onCancel}
                >
                  <X className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <Trans>Cancel</Trans>
              </Tooltip.Content>
            </Tooltip>
          </div>
        }
      />
      {props.candidates.length > 0 ? (
        <ThreadDockList placement="composer" gap="1">
          {props.candidates.map((candidate, index) => {
            const provider = candidate.agentLabel ?? candidate.agentKind;
            const label = [
              candidate.modelLabel,
              candidate.config.effort ? formatEffortLabel(candidate.config.effort) : undefined,
              candidate.config.fast ? t`Fast` : undefined,
            ]
              .filter((value): value is string => !!value)
              .join(" · ");
            const details = [
              label ? provider : undefined,
              candidate.presentationMode === "terminal" ? t`CLI` : t`Chat`,
            ]
              .filter((value): value is string => !!value)
              .join(" · ");
            const title = label || provider;
            const currentChain = candidate.fallbackChain ?? [];
            const availableFallback = props.eligibleFallbackAgents.filter((agent) => {
              if (agent.kind === candidate.agentKind) return false;
              const supported = agent.capabilities.presentationModes ?? [
                agent.capabilities.presentationMode,
              ];
              return supported.includes(candidate.presentationMode);
            });
            return (
              <div key={candidate.id}>
                <ThreadDockActionRow
                  title={details ? `${title} · ${details}` : title}
                  action={<X className="size-3" />}
                  actionLabel={t`Remove candidate ${index + 1}`}
                  actionTitle={t`Remove candidate ${index + 1}`}
                  onAction={() => props.onRemove(candidate.id)}
                  isActionDisabled={props.isSubmitting}
                >
                  <ProviderIcon
                    kind={candidate.agentKind}
                    fallbackLabel={provider}
                    {...(candidate.icon ? { icon: candidate.icon } : {})}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate leading-5 text-foreground">{title}</span>
                  {details ? (
                    <span className="max-w-[55%] shrink-0 truncate text-foreground-muted opacity-80">
                      {details}
                    </span>
                  ) : null}
                </ThreadDockActionRow>
                {availableFallback.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
                    <span className="text-[10px] text-muted/60">
                      <Trans>Fallback:</Trans>
                    </span>
                    {currentChain.map((kind, chainIndex) => {
                      const agent = availableFallback.find((a) => a.kind === kind);
                      return (
                        <Tooltip key={`${kind}-${chainIndex}`} delay={0}>
                          <Tooltip.Trigger>
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] leading-none text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                              onClick={() => {
                                const next = currentChain.filter((_, i) => i !== chainIndex);
                                props.onFallbackChange(candidate.id, next);
                              }}
                            >
                              {agent?.label ?? kind}
                              <X className="size-2.5" />
                            </button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <Trans>Remove fallback agent</Trans>
                          </Tooltip.Content>
                        </Tooltip>
                      );
                    })}
                    {currentChain.length < MAX_EXPERIMENT_FALLBACK_CHAIN &&
                    availableFallback.some(
                      (a) => !currentChain.includes(a.kind),
                    ) ? (
                      <Tooltip delay={0}>
                        <Tooltip.Trigger>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] leading-none text-muted hover:bg-surface-hover hover:text-foreground"
                            onClick={() => {
                              const nextUnused = availableFallback.find(
                                (a) => !currentChain.includes(a.kind),
                              );
                              if (nextUnused) {
                                props.onFallbackChange(candidate.id, [
                                  ...currentChain,
                                  nextUnused.kind,
                                ]);
                              }
                            }}
                          >
                            <Plus className="size-2.5" />
                            <Trans>Add</Trans>
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <Trans>Add fallback agent</Trans>
                        </Tooltip.Content>
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </ThreadDockList>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center text-xs text-muted">
          <Trans>No candidates selected</Trans>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-3 text-xs"
            onPress={props.onAdd}
            isDisabled={props.isAddDisabled}
          >
            <Plus className="size-3.5" />
            <Trans>Add candidates</Trans>
          </Button>
        </div>
      )}
    </ThreadDockSection>
  );
}
