import { useEffect, useState, type FormEvent } from "react";
import { Button, Disclosure, Modal, Spinner } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Megaphone, WifiOff } from "lucide-react";
import type { CampaignProjectExtension } from "@/shared/contracts";
import type { ControlCentreCampaignGroup } from "@/shared/contracts/campaign/controlCentreCampaignGroupList";
import { Input } from "@/renderer/components/common";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import {
  buildUnlinkedCampaignWorkspaceInput,
  createCampaignWorkspace,
} from "@/renderer/actions/campaignProjectActions";
import { useCampaignGroupList } from "@/renderer/hooks/useCampaignGroupList";
import {
  campaignGroupToExtension,
  filterCampaignGroups,
  sortCampaignGroups,
} from "@/renderer/campaign/campaignGroupListUtils";
import { controlCentreManualWorkspaceSuffix } from "@/renderer/campaign/controlCentreAvailabilityCopy";
import {
  CampaignWorkspaceAdvancedFields,
  EMPTY_ADVANCED_VALUES,
  handleAdvancedFormSubmit,
  type CampaignWorkspaceAdvancedValues,
} from "./CampaignWorkspaceAdvancedFields";

export function CreateCampaignWorkspaceDialog() {
  const { t } = useLingui();
  const open = usePanelStore((s) => s.createCampaignProjectModalOpen);
  const projects = useAppStore((s) => s.projects);
  const campaignGroups = useCampaignGroupList({ skip: !open });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedValues, setAdvancedValues] =
    useState<CampaignWorkspaceAdvancedValues>(EMPTY_ADVANCED_VALUES);
  const [unlinkedName, setUnlinkedName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sortedGroups =
    campaignGroups.status === "ready" ? sortCampaignGroups(campaignGroups.data) : [];
  const visibleGroups = filterCampaignGroups(sortedGroups, searchQuery);
  const selectedGroup =
    selectedGroupId !== null
      ? sortedGroups.find((group) => group.id === selectedGroupId)
      : undefined;

  useEffect(() => {
    if (!open) return;
    if (campaignGroups.status === "unavailable" || campaignGroups.status === "error") {
      setAdvancedOpen(true);
    }
  }, [open, campaignGroups.status]);

  function resetForm() {
    setSearchQuery("");
    setSelectedGroupId(null);
    setAdvancedOpen(false);
    setAdvancedValues(EMPTY_ADVANCED_VALUES);
    setUnlinkedName("");
    setSubmitError(null);
  }

  function handleClose() {
    usePanelStore.getState().closeCreateCampaignProjectModal();
    resetForm();
  }

  async function submitPayload(payload: {
    name: string;
    campaignExtension: CampaignProjectExtension;
  }) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const result = await createCampaignWorkspace(payload);
    setIsSubmitting(false);
    if (result.ok) {
      handleClose();
    } else {
      setSubmitError(result.error);
    }
  }

  async function handleCreateFromSelection() {
    if (!selectedGroup) {
      setSubmitError(t`Choose a campaign from the list.`);
      return;
    }
    const extension = campaignGroupToExtension(selectedGroup);
    await submitPayload({ name: selectedGroup.name, campaignExtension: extension });
  }

  async function handleCreateUnlinked() {
    const trimmed = unlinkedName.trim();
    if (!trimmed) {
      setSubmitError(t`Workspace name is required.`);
      return;
    }
    await submitPayload(buildUnlinkedCampaignWorkspaceInput(trimmed));
  }

  async function handleManualSubmit(event: FormEvent) {
    handleAdvancedFormSubmit(
      event,
      advancedValues,
      (payload) => {
        void submitPayload(payload);
      },
      setSubmitError,
    );
  }

  const existingProject =
    selectedGroup &&
    projects.find(
      (project) =>
        project.purpose === "campaign" &&
        project.campaignExtension?.campaignGroupId === selectedGroup.id,
    );

  function renderGroupRow(group: ControlCentreCampaignGroup) {
    const isSelected = selectedGroupId === group.id;
    return (
      <button
        key={group.id}
        type="button"
        onClick={() => {
          setSelectedGroupId(group.id);
          setSubmitError(null);
        }}
        className={`flex w-full items-start gap-3 rounded-medium border px-3 py-2.5 text-left transition-colors ${
          isSelected
            ? "border-primary bg-primary/10"
            : "border-divider bg-content2 hover:bg-content3"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{group.name}</p>
          <p className="truncate text-xs text-muted">
            {group.clientName ?? t`Unknown client`}
            {group.jobNumber ? ` · ${group.jobNumber}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted">
          {group.status}
        </span>
      </button>
    );
  }

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
                <Trans>Add campaign workspace</Trans>
              </div>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <p className="text-small text-muted">
              <Trans>
                Pick a live campaign from Control Centre. Everything else is filled in for you.
              </Trans>
            </p>

            {campaignGroups.status === "loading" ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted">
                <Spinner size="sm" />
                <Trans>Loading campaigns from Control Centre…</Trans>
              </div>
            ) : null}

            {campaignGroups.status === "unavailable" ? (
              <div className="flex items-start gap-2 rounded-medium border border-warning/40 bg-warning/5 p-3">
                <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-small text-foreground">
                  {campaignGroups.message}
                  {campaignGroups.reason !== "connection-failed"
                    ? ` ${t(controlCentreManualWorkspaceSuffix)}`
                    : null}
                </p>
              </div>
            ) : null}

            {campaignGroups.status === "error" ? (
              <p className="text-small text-danger">{campaignGroups.message}</p>
            ) : null}

            {campaignGroups.status === "ready" ? (
              <div className="space-y-3">
                <Input
                  aria-label={t`Search campaigns`}
                  placeholder={t`Search by campaign, client, or job number…`}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  disabled={isSubmitting}
                />
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {visibleGroups.length > 0 ? (
                    visibleGroups.map(renderGroupRow)
                  ) : (
                    <p className="py-4 text-center text-sm text-muted">
                      <Trans>No campaigns match your search.</Trans>
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {existingProject ? (
              <div className="rounded-medium border border-warning/40 bg-warning/5 p-3">
                <p className="text-small text-foreground">
                  <Trans>
                    A workspace for "{existingProject.name}" already exists. Confirming opens the
                    existing workspace.
                  </Trans>
                </p>
              </div>
            ) : null}

            <div className="rounded-medium border border-divider bg-content2 p-3">
              <p className="text-sm font-medium text-foreground">
                <Trans>Start without linking</Trans>
              </p>
              <p className="mt-1 text-small text-muted">
                <Trans>Name your workspace and open it without a Control Centre campaign.</Trans>
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={t`Workspace name`}
                  placeholder={t`e.g. AIB GAA A55201`}
                  value={unlinkedName}
                  data-testid="unlinked-workspace-name"
                  onChange={(event) => {
                    setUnlinkedName(event.target.value);
                    setSubmitError(null);
                  }}
                  disabled={isSubmitting}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="secondary"
                  isDisabled={isSubmitting || unlinkedName.trim().length === 0}
                  onPress={() => void handleCreateUnlinked()}
                >
                  {isSubmitting ? <Trans>Creating…</Trans> : <Trans>Start without linking</Trans>}
                </Button>
              </div>
            </div>

            <Disclosure isExpanded={advancedOpen} onExpandedChange={setAdvancedOpen}>
              <Disclosure.Heading>
                <Disclosure.Trigger className="flex w-full items-center gap-2 py-1 text-left text-sm font-medium text-foreground">
                  <Trans>Advanced</Trans>
                  <Disclosure.Indicator className="ml-auto text-muted" />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="pt-3">
                  <form
                    id="create-campaign-advanced-form"
                    onSubmit={(event) => void handleManualSubmit(event)}
                  >
                    <CampaignWorkspaceAdvancedFields
                      values={advancedValues}
                      onChange={setAdvancedValues}
                      disabled={isSubmitting}
                    />
                  </form>
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>

            {submitError ? <p className="text-small text-danger">{submitError}</p> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={handleClose} isDisabled={isSubmitting}>
              <Trans>Cancel</Trans>
            </Button>
            {advancedOpen ? (
              <Button
                type="submit"
                form="create-campaign-advanced-form"
                variant="primary"
                isDisabled={isSubmitting}
              >
                {isSubmitting ? <Trans>Creating…</Trans> : <Trans>Create manually</Trans>}
              </Button>
            ) : (
              <Button
                variant="primary"
                isDisabled={isSubmitting || !selectedGroup}
                onPress={() => void handleCreateFromSelection()}
              >
                {isSubmitting ? <Trans>Creating…</Trans> : <Trans>Add workspace</Trans>}
              </Button>
            )}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
