import { Button, Label } from "@heroui/react";
import type { FormEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Trash2 } from "lucide-react";
import type { CampaignProjectExtension, McpProfile } from "@/shared/contracts";
import { DEFAULT_MCP_PROFILE, MCP_PROFILES } from "@/shared/contracts/campaign/mcpProfile";
import { Input, Select } from "@/renderer/components/common";

const MCP_PROFILE_OPTIONS = MCP_PROFILES.map((profile) => ({
  id: profile,
  label: profile,
}));

interface ResourceAlias {
  key: string;
  value: string;
}

function validateResourceAliasKey(key: string): string | null {
  if (!key.trim()) return "Alias key is required.";
  if (!key.startsWith("@")) return "Alias keys must start with @.";
  if (key.length > 64) return "Alias key is too long.";
  return null;
}

export interface CampaignWorkspaceAdvancedValues {
  clientName: string;
  campaignName: string;
  campaignGroupId: string;
  jobNumber: string;
  defaultAgentKind: string;
  defaultModel: string;
  mcpProfile: McpProfile;
  resourceAliases: ResourceAlias[];
}

export const EMPTY_ADVANCED_VALUES: CampaignWorkspaceAdvancedValues = {
  clientName: "",
  campaignName: "",
  campaignGroupId: "",
  jobNumber: "",
  defaultAgentKind: "",
  defaultModel: "",
  mcpProfile: DEFAULT_MCP_PROFILE,
  resourceAliases: [{ key: "", value: "" }],
};

export function validateAdvancedValues(values: CampaignWorkspaceAdvancedValues): string | null {
  const trimmedClient = values.clientName.trim();
  const trimmedCampaign = values.campaignName.trim();
  const trimmedGroupId = values.campaignGroupId.trim();

  if (!trimmedClient && !trimmedCampaign && !trimmedGroupId) {
    return "Choose a campaign from the list or fill in the manual fields below.";
  }
  if (!trimmedCampaign && !trimmedGroupId) {
    return "Campaign name is required for a manual workspace.";
  }
  if (!trimmedCampaign) return "Campaign name is required.";
  if (!trimmedClient) return "Client name is required when creating manually.";
  if (!trimmedGroupId) return "Campaign reference is required when creating manually.";

  for (const alias of values.resourceAliases) {
    if (alias.key.trim() || alias.value.trim()) {
      const keyError = validateResourceAliasKey(alias.key);
      if (keyError) return keyError;
      if (!alias.value.trim()) return "Resource alias value is required when key is provided.";
    }
  }

  return null;
}

export function advancedValuesToExtension(
  values: CampaignWorkspaceAdvancedValues,
): CampaignProjectExtension {
  return {
    campaignGroupId: values.campaignGroupId.trim(),
    clientName: values.clientName.trim(),
    campaignName: values.campaignName.trim(),
    ...(values.jobNumber.trim() ? { jobNumber: values.jobNumber.trim() } : {}),
    ...(values.defaultAgentKind.trim() ? { defaultAgentKind: values.defaultAgentKind.trim() } : {}),
    ...(values.defaultModel.trim() ? { defaultModel: values.defaultModel.trim() } : {}),
    mcpProfile: values.mcpProfile,
    ...(values.resourceAliases.some((alias) => alias.key.trim())
      ? {
          resourceAliases: Object.fromEntries(
            values.resourceAliases
              .filter((alias) => alias.key.trim())
              .map((alias) => [alias.key.trim(), alias.value.trim()]),
          ),
        }
      : {}),
  };
}

export function CampaignWorkspaceAdvancedFields(props: {
  values: CampaignWorkspaceAdvancedValues;
  onChange: (values: CampaignWorkspaceAdvancedValues) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  const { values, onChange, disabled } = props;

  function update<K extends keyof CampaignWorkspaceAdvancedValues>(
    key: K,
    value: CampaignWorkspaceAdvancedValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  function updateResourceAlias(index: number, field: "key" | "value", value: string) {
    const next = [...values.resourceAliases];
    const current = next[index]!;
    next[index] = { key: current.key, value: current.value, [field]: value };
    update("resourceAliases", next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Workspace name</Trans>
        </Label>
        <Input
          aria-label={t`Workspace name`}
          placeholder={t`Shown in the sidebar`}
          value={values.campaignName}
          onChange={(event) => update("campaignName", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Client name</Trans>
        </Label>
        <Input
          aria-label={t`Client name`}
          placeholder={t`Acme Corp`}
          value={values.clientName}
          onChange={(event) => update("clientName", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Campaign reference</Trans>
        </Label>
        <Input
          aria-label={t`Campaign reference`}
          placeholder={t`Optional Control Centre campaign id`}
          value={values.campaignGroupId}
          onChange={(event) => update("campaignGroupId", event.target.value)}
          disabled={disabled}
        />
        <p className="text-tiny text-default-500">
          <Trans>Only needed when Control Centre cannot be reached.</Trans>
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Job number</Trans>
        </Label>
        <Input
          aria-label={t`Job number`}
          placeholder={t`Optional reference number`}
          value={values.jobNumber}
          onChange={(event) => update("jobNumber", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Default agent</Trans>
        </Label>
        <Input
          aria-label={t`Default agent`}
          placeholder={t`e.g. claude, codex, gemini`}
          value={values.defaultAgentKind}
          onChange={(event) => update("defaultAgentKind", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Default model</Trans>
        </Label>
        <Input
          aria-label={t`Default model`}
          placeholder={t`e.g. claude-sonnet-4`}
          value={values.defaultModel}
          onChange={(event) => update("defaultModel", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted">
          <Trans>Control Centre connection</Trans>
        </Label>
        <Select
          options={MCP_PROFILE_OPTIONS}
          value={values.mcpProfile}
          onChange={(value) => update("mcpProfile", value as McpProfile)}
          isDisabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted">
          <Trans>Resource aliases</Trans>
        </Label>
        {values.resourceAliases.map((alias, index) => (
          <div key={index} className="flex gap-2">
            <Input
              placeholder={t`@media-plans`}
              value={alias.key}
              onChange={(event) => updateResourceAlias(index, "key", event.target.value)}
              disabled={disabled}
              className="flex-1"
            />
            <Input
              placeholder={t`Path or URL`}
              value={alias.value}
              onChange={(event) => updateResourceAlias(index, "value", event.target.value)}
              disabled={disabled}
              className="flex-1"
            />
            {values.resourceAliases.length > 1 ? (
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() =>
                  update(
                    "resourceAliases",
                    values.resourceAliases.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                aria-label={t`Remove alias`}
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onPress={() =>
            update("resourceAliases", [...values.resourceAliases, { key: "", value: "" }])
          }
        >
          <Plus className="size-4" />
          <Trans>Add alias</Trans>
        </Button>
      </div>
    </div>
  );
}

export function buildManualSubmitPayload(values: CampaignWorkspaceAdvancedValues) {
  const extension = advancedValuesToExtension(values);
  return {
    name: values.campaignName.trim(),
    campaignExtension: extension,
  };
}

export function handleAdvancedFormSubmit(
  event: FormEvent,
  values: CampaignWorkspaceAdvancedValues,
  onValid: (payload: ReturnType<typeof buildManualSubmitPayload>) => void,
  onError: (message: string) => void,
) {
  event.preventDefault();
  const error = validateAdvancedValues(values);
  if (error) {
    onError(error);
    return;
  }
  onValid(buildManualSubmitPayload(values));
}
