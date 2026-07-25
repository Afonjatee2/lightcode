import { msg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import type { CampaignProjectExtension, ProjectLocation } from "@/shared/contracts";
import { campaignProjectExtensionSchema } from "@/shared/contracts";
import { resolveModelSelection } from "@/shared/agentSelection";
import { i18n } from "@/renderer/i18n/i18n";
import { readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";

// ── Types ───────────────────────────────────────────────────────────

export interface CreateCampaignProjectInput {
  name: string;
  campaignExtension: CampaignProjectExtension;
}

export type CampaignWorkspaceOutcome =
  | { ok: true; outcome: "created"; projectId: string; threadId: string }
  | { ok: true; outcome: "opened-existing"; projectId: string; threadId: string }
  | { ok: false; error: string };

// ── Validation ──────────────────────────────────────────────────────

export function validateCampaignProjectInput(input: CreateCampaignProjectInput): string | null {
  const trimmedId = input.campaignExtension.campaignGroupId.trim();
  const trimmedClient = input.campaignExtension.clientName.trim();
  const trimmedCampaign = input.campaignExtension.campaignName.trim();

  if (!trimmedId) return "Campaign group ID is required.";
  if (!trimmedClient) return "Client name is required.";
  if (!trimmedCampaign) return "Campaign name is required.";

  const extResult = campaignProjectExtensionSchema.safeParse(input.campaignExtension);
  if (!extResult.success) {
    return extResult.error.issues[0]?.message ?? "Invalid campaign extension.";
  }

  if (input.name.trim().length === 0) return "Workspace name is required.";

  return null;
}

export function buildUnlinkedCampaignWorkspaceInput(name: string): CreateCampaignProjectInput {
  const trimmed = name.trim();
  return {
    name: trimmed,
    campaignExtension: {
      campaignGroupId: "",
      clientName: trimmed,
      campaignName: trimmed,
    },
  };
}

export function validateUnlinkedCampaignWorkspaceInput(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Workspace name is required.";
  const extResult = campaignProjectExtensionSchema.safeParse({
    campaignGroupId: "",
    clientName: trimmed,
    campaignName: trimmed,
  });
  if (!extResult.success) {
    return extResult.error.issues[0]?.message ?? "Invalid campaign extension.";
  }
  return null;
}

// ── Agent / Model resolution ────────────────────────────────────────

/**
 * Resolve a valid agent kind and model for a campaign thread.
 *
 * Rules (per Phase 4 repository-supported patterns):
 * - Explicit agent must exist and be installed.
 * - Explicit model must belong to the selected agent when capabilities are known.
 * - Missing model resolves from that selected agent only (via resolveModelSelection).
 * - Never fall back to a Claude model for a non-Claude provider.
 * - When no valid installed agent/model exists, return a structured error.
 */
export function resolveAgentAndModelForCampaign(
  explicitKind: string | undefined,
  explicitModel: string | undefined,
): { agentKind: string; model: string } | { error: string } {
  return resolveAgentAndModel(explicitKind, explicitModel);
}

function resolveAgentAndModel(
  explicitKind: string | undefined,
  explicitModel: string | undefined,
): { agentKind: string; model: string } | { error: string } {
  const statuses = useAgentStatusesStore.getState().agentStatuses;
  const installedStatuses = statuses.filter((s) => s.installed);

  if (installedStatuses.length === 0) {
    return {
      error:
        "No agent providers are installed. Install at least one agent to create a campaign workspace.",
    };
  }

  // Resolve the agent kind
  let agentStatus: (typeof installedStatuses)[number] | undefined;
  if (explicitKind) {
    agentStatus = installedStatuses.find((s) => s.kind === explicitKind);
    if (!agentStatus) {
      return {
        error: `Agent "${explicitKind}" is not installed. Install it or choose a different agent.`,
      };
    }
  } else {
    const first = installedStatuses[0];
    if (!first) {
      return {
        error:
          "No agent providers are installed. Install at least one agent to create a campaign workspace.",
      };
    }
    agentStatus = first;
  }

  const agentKind = agentStatus.kind;

  // Resolve the model — explicit model must belong to this agent
  if (explicitModel) {
    const modelExists = agentStatus.capabilities.models.some((m) => m.id === explicitModel);
    if (!modelExists) {
      return {
        error: `Model "${explicitModel}" is not available for ${agentKind}. Choose a model supported by this agent.`,
      };
    }
    return { agentKind, model: explicitModel };
  }

  // Use repository-supported resolution: first model of this agent
  const resolved = resolveModelSelection(agentStatus.capabilities);
  if (!resolved) {
    return {
      error: `No models are available for ${agentKind}. Check the agent configuration.`,
    };
  }

  return { agentKind, model: resolved };
}

// ── Duplicate detection ─────────────────────────────────────────────

/**
 * Find an existing project bound to the same campaign group.
 * Returns undefined when no duplicate exists.
 */
function findExistingCampaignProject(campaignGroupId: string) {
  if (!campaignGroupId.trim()) return undefined;
  const store = useAppStore.getState();
  return store.projects.find(
    (p) => p.purpose === "campaign" && p.campaignExtension?.campaignGroupId === campaignGroupId,
  );
}

/**
 * Find a GUI thread belonging to a campaign project. Used to open or
 * resume an existing workspace without creating a fresh thread.
 */
function findExistingGuiThread(projectId: string) {
  const store = useAppStore.getState();
  return store.threads.find((t) => t.projectId === projectId && t.presentationMode === "gui");
}

// ── Transactional creation ──────────────────────────────────────────

/**
 * Create a campaign workspace project.
 *
 * The production sequence is explicit and not wrapped in `startTransition`:
 *
 * 1. Validate input against the campaign extension contract.
 * 2. Detect duplicate by campaignGroupId.
 * 3. If a duplicate exists:
 *    a. Find an existing GUI thread → open it.
 *    b. No GUI thread → create one, persist it, open it.
 * 4. Generate a single canonical project ID.
 * 5. Ensure the managed campaign workspace directory via IPC.
 * 6. Create the validated Project in store state.
 * 7. Persist the project via IPC.
 *    → On failure: roll back store state.
 * 8. Create an initial GUI thread.
 * 9. Persist the thread via IPC.
 *    → On failure: roll back project + thread from store state.
 * 10. Open the thread.
 * 11. Close the dialog.
 *
 * When ok === false the dialog must stay open with its fields preserved;
 * the caller is responsible for display. Toast messages are for background
 * notification only — actionable errors are in the return value.
 */
export async function createCampaignWorkspace(
  input: CreateCampaignProjectInput,
): Promise<CampaignWorkspaceOutcome> {
  const isUnlinked = input.campaignExtension.campaignGroupId.trim().length === 0;
  const validationError = isUnlinked
    ? validateUnlinkedCampaignWorkspaceInput(input.name)
    : validateCampaignProjectInput(input);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const campaignGroupId = input.campaignExtension.campaignGroupId.trim();

  // ── 2. Duplicate detection ───────────────────────────────────
  const existing = findExistingCampaignProject(campaignGroupId);
  if (existing) {
    const existingThread = findExistingGuiThread(existing.id);
    if (existingThread) {
      usePanelStore.getState().closeCreateCampaignProjectModal();
      useAppStore.getState().openThread(existingThread.id);
      toast.success(i18n._(msg`Opened existing campaign workspace "${existing.name}".`));
      return {
        ok: true,
        outcome: "opened-existing",
        projectId: existing.id,
        threadId: existingThread.id,
      };
    }

    // No GUI thread yet — create one for the existing project.
    const resolved = resolveAgentAndModel(
      input.campaignExtension.defaultAgentKind,
      input.campaignExtension.defaultModel,
    );
    if ("error" in resolved) {
      return { ok: false, error: resolved.error };
    }

    let newThread: ReturnType<ReturnType<typeof useAppStore.getState>["createThread"]>;
    try {
      newThread = useAppStore.getState().createThread({
        projectId: existing.id,
        agentKind: resolved.agentKind,
        config: { model: resolved.model, mode: "agent" },
        prompt: "",
        title: existing.name,
        presentationMode: "gui",
        focus: true,
      });
      await readBridge().dbUpsertThread(newThread);
    } catch {
      if (newThread!) useAppStore.getState().deleteThread(newThread!.id);
      return {
        ok: false,
        error: i18n._(msg`Could not create a thread for the existing campaign workspace.`),
      };
    }

    usePanelStore.getState().closeCreateCampaignProjectModal();
    useAppStore.getState().openThread(newThread.id);
    toast.success(i18n._(msg`Opened existing campaign workspace "${existing.name}".`));
    return {
      ok: true,
      outcome: "opened-existing",
      projectId: existing.id,
      threadId: newThread.id,
    };
  }

  // ── 3. Generate canonical project ID ─────────────────────────
  const projectId = crypto.randomUUID();

  // ── 4. Ensure managed directory ──────────────────────────────
  let location: ProjectLocation;
  try {
    const result = await readBridge().ensureCampaignWorkspaceDir({
      projectId,
      name: input.name,
      clientName: input.campaignExtension.clientName,
      campaignName: input.campaignExtension.campaignName,
      ...(input.campaignExtension.jobNumber
        ? { jobNumber: input.campaignExtension.jobNumber }
        : {}),
    });
    location = result.location;
  } catch {
    return {
      ok: false,
      error: i18n._(msg`Could not create the campaign workspace directory.`),
    };
  }

  // ── 5. Create project in store state ─────────────────────────
  const project = useAppStore.getState().addCampaignProject(
    location,
    {
      ...input.campaignExtension,
      campaignGroupId,
    },
    input.name.trim(),
    projectId,
  );

  // ── 6. Persist project ───────────────────────────────────────
  try {
    await readBridge().dbUpsertProject(project);
  } catch {
    useAppStore.getState().deleteProject(project.id);
    return {
      ok: false,
      error: i18n._(msg`Could not save the campaign project.`),
    };
  }

  // ── 7. Create initial GUI thread ─────────────────────────────
  const resolved = resolveAgentAndModel(
    input.campaignExtension.defaultAgentKind,
    input.campaignExtension.defaultModel,
  );
  if ("error" in resolved) {
    useAppStore.getState().deleteProject(project.id);
    return { ok: false, error: resolved.error };
  }

  let threadId: string;
  try {
    const thread = useAppStore.getState().createThread({
      projectId: project.id,
      agentKind: resolved.agentKind,
      config: { model: resolved.model, mode: "agent" },
      prompt: "",
      title: project.name,
      presentationMode: "gui",
      focus: true,
    });
    threadId = thread.id;
  } catch {
    useAppStore.getState().deleteProject(project.id);
    return {
      ok: false,
      error: i18n._(msg`Could not create the campaign workspace thread.`),
    };
  }

  // ── 8. Persist thread ────────────────────────────────────────
  try {
    const threaded = useAppStore.getState().threads.find((t) => t.id === threadId);
    if (!threaded) {
      useAppStore.getState().deleteProject(project.id);
      return {
        ok: false,
        error: i18n._(msg`Thread was not found after creation — the workspace could not be saved.`),
      };
    }
    await readBridge().dbUpsertThread(threaded);
  } catch {
    useAppStore.getState().deleteThread(threadId);
    useAppStore.getState().deleteProject(project.id);
    return {
      ok: false,
      error: i18n._(msg`Could not save the campaign workspace thread.`),
    };
  }

  // ── 9. Open + close ──────────────────────────────────────────
  useAppStore.getState().openThread(threadId);
  usePanelStore.getState().closeCreateCampaignProjectModal();
  toast.success(i18n._(msg`Campaign workspace "${input.name.trim()}" created.`));

  return {
    ok: true,
    outcome: "created",
    projectId: project.id,
    threadId,
  };
}
