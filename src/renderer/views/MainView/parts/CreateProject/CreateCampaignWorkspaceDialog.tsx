import { useState, useEffect, type FormEvent } from "react";
import { Button, Label, Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Megaphone, Plus, Trash2, WifiOff } from "lucide-react";
import type { CampaignProjectExtension, McpProfile } from "@/shared/contracts";
import { MCP_PROFILES } from "@/shared/contracts/campaign/mcpProfile";
import { Input, Select } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useOperationsToday } from "@/renderer/hooks/useOperationsToday";
import { createCampaignWorkspace } from "@/renderer/actions/campaignProjectActions";
import { controlCentreManualWorkspaceSuffix } from "@/renderer/campaign/controlCentreAvailabilityCopy";

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

export function CreateCampaignWorkspaceDialog() {
  const { t } = useLingui();
  const open = usePanelStore((s) => s.createCampaignProjectModalOpen);
  const projects = useAppStore((s) => s.projects);

  const [clientName, setClientName] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignGroupId, setCampaignGroupId] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [defaultAgentKind, setDefaultAgentKind] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [mcpProfile, setMcpProfile] = useState<McpProfile>("monitoring");
  const [resourceAliases, setResourceAliases] = useState<ResourceAlias[]>([{ key: "", value: "" }]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCampaignFromCC, setSelectedCampaignFromCC] = useState<string | null>(null);

  const operationsToday = useOperationsToday(undefined, { skip: !open });

  useEffect(() => {
    if (selectedCampaignFromCC && operationsToday.status === "ready") {
      const campaign = operationsToday.data.needsAttention
        .concat(operationsToday.data.waitingForApproval)
        .concat(operationsToday.data.otherLive)
        .find((c) => c.campaignGroupId === selectedCampaignFromCC);
      if (campaign) {
        setCampaignGroupId(campaign.campaignGroupId);
        setClientName(campaign.clientName);
        setCampaignName(campaign.campaignName);
      }
    }
  }, [selectedCampaignFromCC, operationsToday]);

  function resetForm() {
    setClientName("");
    setCampaignName("");
    setCampaignGroupId("");
    setJobNumber("");
    setDefaultAgentKind("");
    setDefaultModel("");
    setMcpProfile("monitoring");
    setResourceAliases([{ key: "", value: "" }]);
    setSubmitError(null);
    setSelectedCampaignFromCC(null);
  }

  function handleClose() {
    usePanelStore.getState().closeCreateCampaignProjectModal();
    resetForm();
  }

  function addResourceAlias() {
    setResourceAliases([...resourceAliases, { key: "", value: "" }]);
  }

  function updateResourceAlias(index: number, field: "key" | "value", value: string) {
    const next = [...resourceAliases];
    const current = next[index]!;
    next[index] = { key: current.key, value: current.value, [field]: value };
    setResourceAliases(next);
  }

  function removeResourceAlias(index: number) {
    if (resourceAliases.length <= 1) return;
    setResourceAliases(resourceAliases.filter((_, i) => i !== index));
  }

  function validate(): string | null {
    const trimmedClient = clientName.trim();
    const trimmedCampaign = campaignName.trim();
    const trimmedGroupId = campaignGroupId.trim();

    if (!trimmedClient) return "Client name is required.";
    if (!trimmedCampaign) return "Campaign name is required.";
    if (!trimmedGroupId) return "Campaign group ID is required.";

    for (const alias of resourceAliases) {
      if (alias.key.trim() || alias.value.trim()) {
        const keyError = validateResourceAliasKey(alias.key);
        if (keyError) return keyError;
        if (!alias.value.trim()) return "Resource alias value is required when key is provided.";
      }
    }

    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    const error = validate();
    if (error) {
      setSubmitError(error);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const extension: CampaignProjectExtension = {
      campaignGroupId: campaignGroupId.trim(),
      clientName: clientName.trim(),
      campaignName: campaignName.trim(),
      ...(jobNumber.trim() ? { jobNumber: jobNumber.trim() } : {}),
      ...(defaultAgentKind.trim() ? { defaultAgentKind: defaultAgentKind.trim() } : {}),
      ...(defaultModel.trim() ? { defaultModel: defaultModel.trim() } : {}),
      mcpProfile,
      ...(resourceAliases.some((a) => a.key.trim())
        ? {
            resourceAliases: Object.fromEntries(
              resourceAliases
                .filter((a) => a.key.trim())
                .map((a) => [a.key.trim(), a.value.trim()]),
            ),
          }
        : {}),
    };

    const result = await createCampaignWorkspace({
      name: campaignName.trim(),
      campaignExtension: extension,
    });

    setIsSubmitting(false);

    if (result.ok) {
      handleClose();
    } else {
      setSubmitError(result.error);
    }
  }

  const existingProject = projects.find(
    (p) =>
      p.purpose === "campaign" && p.campaignExtension?.campaignGroupId === campaignGroupId.trim(),
  );

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[640px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <div className="flex items-center gap-2">
                <Megaphone className="size-5" />
                <Trans>Create Campaign Workspace</Trans>
              </div>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <form
              id="create-campaign-form"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit(e);
              }}
              className="space-y-4"
            >
              {operationsToday.status === "ready" && operationsToday.data.counts.total > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted">
                    <Trans>Or pick from Control Centre</Trans>
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ...operationsToday.data.needsAttention,
                      ...operationsToday.data.waitingForApproval,
                      ...operationsToday.data.otherLive,
                    ].map((campaign) => (
                      <button
                        key={campaign.campaignGroupId}
                        type="button"
                        onClick={() => setSelectedCampaignFromCC(campaign.campaignGroupId)}
                        className={`rounded-medium border px-3 py-2 text-left transition-colors ${
                          selectedCampaignFromCC === campaign.campaignGroupId
                            ? "border-primary bg-primary/10"
                            : "border-divider bg-content2 hover:bg-content3"
                        }`}
                      >
                        <p className="text-small font-medium">{campaign.clientName}</p>
                        <p className="text-tiny text-default-500">{campaign.campaignName}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {operationsToday.status === "unavailable" && (
                <div className="flex items-start gap-2 rounded-medium border border-warning/40 bg-warning/5 p-3">
                  <WifiOff className="size-4 shrink-0 text-warning mt-0.5" />
                  <p className="text-small text-foreground">
                    {operationsToday.message}
                    {operationsToday.reason !== "connection-failed"
                      ? ` ${t(controlCentreManualWorkspaceSuffix)}`
                      : null}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Client Name</Trans>
                </Label>
                <Input
                  aria-label={t`Client name`}
                  placeholder={t`Acme Corp`}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Campaign Name</Trans>
                </Label>
                <Input
                  aria-label={t`Campaign name`}
                  placeholder={t`Q4 Brand Launch`}
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Campaign Group ID</Trans>
                </Label>
                <Input
                  aria-label={t`Campaign group ID`}
                  placeholder={t`e.g. cg-abc-123`}
                  value={campaignGroupId}
                  onChange={(e) => setCampaignGroupId(e.target.value)}
                  disabled={isSubmitting}
                />
                <p className="text-tiny text-default-500">
                  <Trans>The Control Centre campaign group this workspace binds to.</Trans>
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Job Number</Trans>
                </Label>
                <Input
                  aria-label={t`Job number`}
                  placeholder={t`Optional reference number`}
                  value={jobNumber}
                  onChange={(e) => setJobNumber(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Default Agent</Trans>
                </Label>
                <Input
                  aria-label={t`Default agent`}
                  placeholder={t`e.g. claude, codex, gemini`}
                  value={defaultAgentKind}
                  onChange={(e) => setDefaultAgentKind(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Default Model</Trans>
                </Label>
                <Input
                  aria-label={t`Default model`}
                  placeholder={t`e.g. claude-sonnet-4`}
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted">
                  <Trans>MCP Profile</Trans>
                </Label>
                <Select
                  options={MCP_PROFILE_OPTIONS}
                  value={mcpProfile}
                  onChange={(v) => setMcpProfile(v as McpProfile)}
                  isDisabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted">
                  <Trans>Resource Aliases</Trans>
                </Label>
                {resourceAliases.map((alias, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder={t`@media-plans`}
                      value={alias.key}
                      onChange={(e) => updateResourceAlias(index, "key", e.target.value)}
                      disabled={isSubmitting}
                      className="flex-1"
                    />
                    <Input
                      placeholder={t`Path or URL`}
                      value={alias.value}
                      onChange={(e) => updateResourceAlias(index, "value", e.target.value)}
                      disabled={isSubmitting}
                      className="flex-1"
                    />
                    {resourceAliases.length > 1 && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        onPress={() => removeResourceAlias(index)}
                        aria-label={t`Remove alias`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onPress={addResourceAlias}>
                  <Plus className="size-4" />
                  <Trans>Add Alias</Trans>
                </Button>
              </div>

              {existingProject && (
                <div className="rounded-medium border border-warning/40 bg-warning/5 p-3">
                  <p className="text-small text-foreground">
                    <Trans>
                      A campaign workspace for "{existingProject.name}" already exists with this
                      campaign group ID. Opening it will switch to the existing workspace.
                    </Trans>
                  </p>
                </div>
              )}

              {submitError && <p className="text-small text-danger">{submitError}</p>}
            </form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={handleClose} isDisabled={isSubmitting}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              form="create-campaign-form"
              variant="primary"
              isDisabled={isSubmitting}
            >
              {isSubmitting ? <Trans>Creating…</Trans> : <Trans>Create Campaign Workspace</Trans>}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
