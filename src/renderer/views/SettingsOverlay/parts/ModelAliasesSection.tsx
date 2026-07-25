import { useState } from "react";
import { Button, Input, toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import { Select } from "@/renderer/components/common";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getSettingsInstalledAgents } from "@/shared/agentStatus";
import type { ModelAlias } from "@/shared/modelAliases";
import { validateModelAlias } from "@/shared/modelAliases";
import { SettingRow } from "./SettingsForm";

type DraftAlias = {
  alias: string;
  provider: string;
  model: string;
  effort: string;
};

function toDraft(entry: ModelAlias): DraftAlias {
  return {
    alias: entry.alias,
    provider: entry.provider,
    model: entry.model,
    effort: entry.effort ?? "",
  };
}

function toModelAlias(draft: DraftAlias): ModelAlias {
  const effort = draft.effort.trim();
  return {
    alias: draft.alias.trim(),
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    ...(effort ? { effort } : {}),
  };
}

export function ModelAliasesSection() {
  const { t } = useLingui();
  const modelAliases = useSharedSettings((state) => state.modelAliases);
  const setModelAliases = useSharedSettings((state) => state.setModelAliases);
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((s) => s.wslAgentStatuses);
  const providers = getSettingsInstalledAgents(agentStatuses, wslAgentStatuses).map(
    (status) => status.kind,
  );
  const [drafts, setDrafts] = useState<DraftAlias[]>(() => modelAliases.map(toDraft));

  function updateDraft(index: number, patch: Partial<DraftAlias>) {
    setDrafts((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)),
    );
  }

  function addRow() {
    setDrafts((current) => [
      ...current,
      { alias: "", provider: providers[0] ?? "codex", model: "", effort: "" },
    ]);
  }

  function removeRow(index: number) {
    setDrafts((current) => current.filter((_, entryIndex) => entryIndex !== index));
  }

  function saveAliases() {
    const next: ModelAlias[] = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index]!;
      const error = validateModelAlias(draft.alias, next);
      if (error) {
        const message =
          error.code === "empty_alias"
            ? t`Alias is required.`
            : error.code === "invalid_alias"
              ? t`Alias must be a single token (letters, numbers, hyphens, dots).`
              : error.code === "duplicate_alias"
                ? t`Alias @${error.alias} is already in use.`
                : error.code === "reserved_alias"
                  ? t`@${error.alias} is reserved for a built-in mention.`
                  : t`Invalid alias.`;
        toast.warning(message);
        return;
      }
      if (!draft.provider.trim() || !draft.model.trim()) {
        toast.warning(t`Each alias needs a provider and model.`);
        return;
      }
      next.push(toModelAlias(draft));
    }
    setModelAliases(next);
    setDrafts(next.map(toDraft));
    toast.success(t`Model aliases saved.`);
  }

  const dirty =
    drafts.length !== modelAliases.length ||
    drafts.some((draft, index) => {
      const saved = modelAliases[index];
      if (!saved) return true;
      return (
        draft.alias !== saved.alias ||
        draft.provider !== saved.provider ||
        draft.model !== saved.model ||
        draft.effort !== (saved.effort ?? "")
      );
    });

  return (
    <div
      className="space-y-3"
      id="agentsGeneral.modelAliases"
      data-settings-anchor="agentsGeneral.modelAliases"
    >
      <SettingRow
        title={t`Model aliases`}
        description={
          <Trans>
            Type <code>@alias</code> in the campaign composer to run a consultation on a specific
            provider, model, and effort.
          </Trans>
        }
      >
        <Button size="sm" variant="ghost" onPress={addRow}>
          <Plus className="size-3.5" aria-hidden />
          <Trans>Add</Trans>
        </Button>
      </SettingRow>

      {drafts.length === 0 ? (
        <p className="text-xs text-muted">
          <Trans>No aliases yet. Add one to mention a model like @gpt-5.6-sol-high.</Trans>
        </p>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft, index) => (
            <div
              key={`alias-row-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2"
            >
              <Input
                aria-label={t`Alias`}
                placeholder={t`gpt-5.6-sol-high`}
                value={draft.alias}
                onChange={(event) => updateDraft(index, { alias: event.target.value })}
                className="text-xs"
              />
              <Select
                aria-label={t`Provider`}
                className="text-xs"
                options={providers.map((provider) => ({ id: provider, label: provider }))}
                value={draft.provider}
                onChange={(value) => updateDraft(index, { provider: value })}
              />
              <Input
                aria-label={t`Model`}
                placeholder={t`gpt-5.6-sol`}
                value={draft.model}
                onChange={(event) => updateDraft(index, { model: event.target.value })}
                className="text-xs"
              />
              <Input
                aria-label={t`Effort`}
                placeholder={t`high`}
                value={draft.effort}
                onChange={(event) => updateDraft(index, { effort: event.target.value })}
                className="text-xs"
              />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t`Remove alias`}
                onPress={() => removeRow(index)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}

      {dirty ? (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onPress={saveAliases}>
            <Trans>Save aliases</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
