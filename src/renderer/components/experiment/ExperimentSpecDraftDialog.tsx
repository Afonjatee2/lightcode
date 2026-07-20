import { useState } from "react";
import { Modal, TextArea } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Loader2, Sparkles } from "lucide-react";
import type { AgentStatus, ProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { Button } from "@/renderer/components/common/Button";
import {
  buildModelPickerControls,
  buildProviderModelMenuProviders,
} from "@/renderer/components/thread/buildModelPickerControls";
import { ThreadComposer } from "@/renderer/components/thread/ThreadComposer";
import {
  resolveEffortValue,
  resolveFastValue,
  resolveModelValue,
} from "@/renderer/components/thread/threadDraftViewHelpers";
import { requestExecutorSpec } from "@/renderer/utils/executorSpecGen";

interface DraftConfig {
  agentKind: string;
  model: string;
  effort: string;
  fast: boolean;
}

function initialConfig(agents: readonly AgentStatus[], preferredKind?: string): DraftConfig | null {
  const agent = agents.find((candidate) => candidate.kind === preferredKind) ?? agents[0];
  if (!agent) return null;
  const model = resolveModelValue(agent, undefined);
  return {
    agentKind: agent.kind,
    model,
    effort: resolveEffortValue(agent, model, undefined),
    fast: resolveFastValue(agent, model, undefined),
  };
}

/**
 * Orchestrator dialog: the user types a short task, picks a one-shot agent, and
 * that agent drafts a full executor spec (repo read-only). The drafted spec is
 * editable and, on confirm, becomes the experiment prompt via `onUseSpec`.
 */
export function ExperimentSpecDraftDialog(props: {
  agents: AgentStatus[];
  projectLocation: ProjectLocation;
  preferredAgentKind?: string;
  onUseSpec: (spec: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [config, setConfig] = useState<DraftConfig | null>(() =>
    initialConfig(props.agents, props.preferredAgentKind),
  );
  const [task, setTask] = useState("");
  const [spec, setSpec] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = config
    ? (props.agents.find((candidate) => candidate.kind === config.agentKind) ?? props.agents[0])
    : props.agents[0];

  const controls =
    selectedAgent && config
      ? buildModelPickerControls({
          providers: buildProviderModelMenuProviders(props.agents),
          selectedAgentKind: selectedAgent.kind,
          model: config.model,
          effort: config.effort,
          fast: config.fast,
          capabilities: selectedAgent.capabilities,
          hideLabelOnWrap: false,
          includeFastToggle: true,
          onProviderModelChange: (next) => {
            const nextAgent = props.agents.find((candidate) => candidate.kind === next.agentKind);
            if (!nextAgent) return;
            const model = resolveModelValue(nextAgent, next.model);
            setConfig({
              agentKind: nextAgent.kind,
              model,
              effort: resolveEffortValue(nextAgent, model, config.effort),
              fast: resolveFastValue(nextAgent, model, config.fast),
            });
          },
          onConfigPatch: (patch) => {
            setConfig({
              ...config,
              ...(patch.effort !== undefined ? { effort: patch.effort } : {}),
              ...(patch.fast !== undefined ? { fast: patch.fast } : {}),
            });
          },
        })
      : [];

  const canDraft = Boolean(config?.model) && task.trim().length > 0 && !drafting;

  async function draft() {
    if (!config || !selectedAgent || task.trim().length === 0) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await requestExecutorSpec({
        projectLocation: props.projectLocation,
        agent: selectedAgent,
        model: config.model,
        effort: config.effort,
        fast: config.fast,
        task: task.trim(),
      });
      setSpec(result);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container size="md">
        <Modal.Dialog className="sm:max-w-[720px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-default text-foreground">
              <Sparkles className="size-5" />
            </Modal.Icon>
            <Modal.Heading>
              <Trans>Draft executor spec</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              <Trans>
                Describe the task in a sentence or two. The selected model reads the repo
                (read-only) and drafts a full, editable executor spec you can hand to the
                candidates.
              </Trans>
            </p>
            {props.agents.length === 0 ? (
              <p className="text-sm text-danger">
                <Trans>
                  No one-shot-capable agent is available. Sign in to an agent that supports
                  one-shot generation (Codex, Claude, Kimi, Qwen…) to draft a spec.
                </Trans>
              </p>
            ) : null}
            <TextArea
              aria-label={t`Task`}
              className="text-sm"
              rows={3}
              placeholder={t`e.g. Fix the Overview page so ?month= controls the displayed reporting month`}
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
            <div className="-ml-1.5">
              <ThreadComposer
                compact
                toolbarOnly
                hideSubmitButton
                controls={controls}
                placeholder=""
                prompt=""
                submitDisabled
                submitLabel=""
                onPromptChange={() => undefined}
                onSubmit={() => undefined}
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {spec !== null ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted">
                  <Trans>Drafted spec — edit before using</Trans>
                </span>
                <TextArea
                  aria-label={t`Drafted executor spec`}
                  className="font-mono text-xs"
                  rows={16}
                  spellCheck={false}
                  value={spec}
                  onChange={(event) => setSpec(event.target.value)}
                />
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            {spec === null ? (
              <Button isDisabled={!canDraft} isPending={drafting} onPress={() => void draft()}>
                {drafting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                <Trans>Draft spec</Trans>
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  isDisabled={!canDraft}
                  isPending={drafting}
                  onPress={() => void draft()}
                >
                  <Trans>Redraft</Trans>
                </Button>
                <Button isDisabled={spec.trim().length === 0} onPress={() => props.onUseSpec(spec)}>
                  <Trans>Use this spec</Trans>
                </Button>
              </>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
