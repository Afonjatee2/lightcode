import { beforeEach, describe, expect, test, vi } from "vitest";

const captured = {
  dirProjectId: null as string | null,
};

let storeProjects: unknown[] = [];
let storeThreads: unknown[] = [];
let openThreadSpy = vi.fn<(id: string) => void>();
let deleteProjectSpy = vi.fn<(id: string) => void>();
let deleteThreadSpy = vi.fn<(id: string) => void>();

const mocks = vi.hoisted(() => ({
  ensureCampaignWorkspaceDir: vi.fn<
    (p: { projectId: string; name?: string }) => Promise<{ path: string; location: { kind: "posix"; path: string } }>
  >(async (payload) => {
    captured.dirProjectId = payload.projectId;
    return { path: "/tmp/camp/" + payload.projectId, location: { kind: "posix", path: "/tmp/camp/" + payload.projectId } };
  }),
  dbUpsertProject: vi.fn<() => Promise<void>>(async () => {}),
  dbUpsertThread: vi.fn<() => Promise<void>>(async () => {}),
  closeCreateCampaignProjectModal: vi.fn<() => void>(),
  agentStatuses: [
    {
      kind: "claude",
      label: "Claude",
      installed: true,
      capabilities: {
        models: [{ id: "claude-sonnet-4" }],
        thinkingModels: [],
        approvalPolicies: [],
        sandboxModes: [],
        quickApprovalPolicies: [],
        modes: [],
        templateResolutions: [],
        contextSizes: [],
        contextHistorySizes: [],
        efforts: [],
        modelEfforts: {},
        defaultEffort: undefined,
      },
    },
  ],
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    ensureCampaignWorkspaceDir: mocks.ensureCampaignWorkspaceDir,
    dbUpsertProject: mocks.dbUpsertProject,
    dbUpsertThread: mocks.dbUpsertThread,
  }),
}));

vi.mock("@/renderer/i18n/i18n", () => ({ i18n: { _: (m: { message: string }) => m.message } }));

vi.mock("@/renderer/state/panelStore", () => ({
  usePanelStore: {
    getState: () => ({
      closeCreateCampaignProjectModal: mocks.closeCreateCampaignProjectModal,
    }),
  },
}));

vi.mock("@/renderer/state/agentStatusesStore", () => ({
  useAgentStatusesStore: {
    getState: () => ({ agentStatuses: mocks.agentStatuses }),
  },
}));

let nextThreadId = 0;

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      get projects() { return storeProjects; },
      get threads() { return storeThreads; },
      addCampaignProject(loc: unknown, ext: unknown, name?: string, projectId?: string) {
        const p = {
          id: projectId ?? "gen-" + Math.random().toString(36).slice(2, 10),
          name: name ?? "camp",
          purpose: "campaign" as const,
          campaignExtension: ext,
          location: loc,
          createdAt: "2026-01-01T00:00:00.000Z",
        };
        storeProjects = [p, ...storeProjects];
        return p;
      },
      createThread(input: { projectId: string; agentKind: string; config: unknown; presentationMode?: string; prompt?: string; focus?: boolean }) {
        const t = {
          id: "thread-" + (++nextThreadId),
          projectId: input.projectId,
          title: "Campaign Workspace",
          agentKind: input.agentKind,
          config: input.config,
          status: "inactive" as const,
          attention: "none" as const,
          archived: false, done: false, starred: false,
          presentationMode: (input.presentationMode ?? "gui") as "terminal" | "gui",
          sortOrder: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          canResumeWithConfig: false,
        };
        storeThreads = [...storeThreads, t];
        return t;
      },
      openThread: openThreadSpy,
      deleteProject: deleteProjectSpy,
      deleteThread: deleteThreadSpy,
    }),
  },
}));

const {
  createCampaignWorkspace,
  validateCampaignProjectInput,
} = await import("@/renderer/actions/campaignProjectActions");

const validExt = {
  campaignGroupId: "cg-abc-123",
  clientName: "Acme Corp",
  campaignName: "Q4 Launch",
};

function validInput() {
  return { name: "Q4 Campaign", campaignExtension: validExt };
}

beforeEach(() => {
  vi.clearAllMocks();
  openThreadSpy = vi.fn<(id: string) => void>();
  deleteProjectSpy = vi.fn<(id: string) => void>();
  deleteThreadSpy = vi.fn<(id: string) => void>();
  captured.dirProjectId = null;
  storeProjects = [];
  storeThreads = [];
  nextThreadId = 0;
  mocks.dbUpsertProject.mockResolvedValue(undefined);
  mocks.dbUpsertThread.mockResolvedValue(undefined);
});

// ── Validation ───────────────────────────────────────────────────────

describe("validateCampaignProjectInput", () => {
  test("accepts a valid input", () => {
    expect(validateCampaignProjectInput(validInput())).toBeNull();
  });

  test("rejects blank campaignGroupId", () => {
    const input = { ...validInput(), campaignExtension: { ...validExt, campaignGroupId: "   " } };
    expect(validateCampaignProjectInput(input)).toBe("Campaign group ID is required.");
  });

  test("rejects blank clientName", () => {
    const input = { ...validInput(), campaignExtension: { ...validExt, clientName: "" } };
    expect(validateCampaignProjectInput(input)).toBe("Client name is required.");
  });

  test("rejects blank campaignName", () => {
    const input = { ...validInput(), campaignExtension: { ...validExt, campaignName: "  " } };
    expect(validateCampaignProjectInput(input)).toBe("Campaign name is required.");
  });

  test("rejects empty workspace name", () => {
    const input = { ...validInput(), name: "  " };
    expect(validateCampaignProjectInput(input)).toBe("Workspace name is required.");
  });
});

// ── Successful creation ──────────────────────────────────────────────

describe("createCampaignWorkspace success", () => {
  test("returns ok with projectId and threadId", async () => {
    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(true);
    const okResult = result as { ok: true; outcome: string; projectId: string; threadId: string };
    expect(okResult.outcome).toBe("created");
    expect(okResult.projectId).toBeTruthy();
    expect(okResult.threadId).toBeTruthy();
  });

  test("same project ID used for directory and project", async () => {
    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(true);
    const okResult = result as { ok: true; outcome: string; projectId: string; threadId: string };
    expect(captured.dirProjectId).toBe(okResult.projectId);
  });

  test("closes dialog on success", async () => {
    await createCampaignWorkspace(validInput());
    expect(mocks.closeCreateCampaignProjectModal).toHaveBeenCalled();
  });

  test("opens the created thread", async () => {
    await createCampaignWorkspace(validInput());
    expect(openThreadSpy).toHaveBeenCalled();
  });
});

// ── Structured failures ──────────────────────────────────────────────

describe("createCampaignWorkspace structured failures", () => {
  test("returns validation error without touching filesystem", async () => {
    const result = await createCampaignWorkspace({
      name: "Test",
      campaignExtension: { ...validExt, campaignGroupId: "" },
    });

    expect(result.ok).toBe(false);
    const failResult = result as { ok: false; error: string };
    expect(failResult.error).toBe("Campaign group ID is required.");
    expect(mocks.ensureCampaignWorkspaceDir).not.toHaveBeenCalled();
  });

  test("returns directory creation failure", async () => {
    mocks.ensureCampaignWorkspaceDir.mockRejectedValueOnce(new Error("ENOSPC"));
    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(false);
    const failResult = result as { ok: false; error: string };
    expect(failResult.error).toBeTruthy();
  });

  test("returns project persistence failure", async () => {
    mocks.dbUpsertProject.mockRejectedValueOnce(new Error("DB error"));
    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(false);
    const failResult2 = result as { ok: false; error: string };
    expect(failResult2.error).toBeTruthy();
    expect(deleteProjectSpy).toHaveBeenCalled();
  });

  test("returns thread persistence failure", async () => {
    mocks.dbUpsertThread.mockRejectedValueOnce(new Error("DB error"));
    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(false);
    const failResult3 = result as { ok: false; error: string };
    expect(failResult3.error).toBeTruthy();
    expect(deleteThreadSpy).toHaveBeenCalled();
    expect(deleteProjectSpy).toHaveBeenCalled();
  });

  test("does not close dialog on failure", async () => {
    mocks.ensureCampaignWorkspaceDir.mockRejectedValueOnce(new Error("fail"));
    await createCampaignWorkspace(validInput());
    expect(mocks.closeCreateCampaignProjectModal).not.toHaveBeenCalled();
  });
});

// ── Duplicate detection ──────────────────────────────────────────────

describe("createCampaignWorkspace duplicate handling", () => {
  test("opens existing GUI thread when duplicate project found", async () => {
    const existingId = "dup-project-id";
    const threadId = "gui-thread-1";
    storeProjects = [{
      id: existingId, name: "Existing", purpose: "campaign",
      campaignExtension: validExt,
      location: { kind: "posix", path: "/tmp/existing" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }];
    storeThreads = [{
      id: threadId, projectId: existingId, title: "Existing",
      agentKind: "claude", config: { model: "claude-sonnet-4" },
      status: "inactive", attention: "none",
      archived: false, done: false, starred: false,
      presentationMode: "gui", sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      canResumeWithConfig: false,
    }];

    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(true);
    const okResult = result as { ok: true; outcome: string; projectId: string; threadId: string };
    expect(okResult.outcome).toBe("opened-existing");
    expect(okResult.projectId).toBe(existingId);
    expect(okResult.threadId).toBe(threadId);
  });

  test("creates new GUI thread for existing project without one", async () => {
    const existingId = "dup-no-thread";
    storeProjects = [{
      id: existingId, name: "Existing No Thread", purpose: "campaign",
      campaignExtension: validExt,
      location: { kind: "posix", path: "/tmp/existing" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }];
    storeThreads = []; // No threads

    const result = await createCampaignWorkspace(validInput());

    expect(result.ok).toBe(true);
    const okResult = result as { ok: true; outcome: string; projectId: string; threadId: string };
    expect(okResult.outcome).toBe("opened-existing");
    expect(okResult.projectId).toBe(existingId);
    expect(okResult.threadId).toBeTruthy();
    expect(mocks.dbUpsertThread).toHaveBeenCalled();
  });

  test("does not create duplicate project on repeated submit", async () => {
    // Set up existing project
    storeProjects = [{
      id: "existing-1", name: "Existing", purpose: "campaign",
      campaignExtension: validExt,
      location: { kind: "posix", path: "/tmp/existing" },
      createdAt: "2026-01-01T00:00:00.000Z",
    }];

    // First call finds existing
    const r1 = await createCampaignWorkspace(validInput());
    expect(r1.ok).toBe(true);

    // Second call also finds existing (no duplicate created)
    const r2 = await createCampaignWorkspace(validInput());
    expect(r2.ok).toBe(true);

    // Only 1 project in store (no duplicates added)
    expect(storeProjects.length).toBe(1);
  });
});
