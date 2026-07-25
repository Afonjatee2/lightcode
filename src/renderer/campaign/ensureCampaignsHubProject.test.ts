import { beforeEach, describe, expect, it, vi } from "vitest";

type EnsureDirResult = { location: { kind: string; path: string } };
const ensureDir = vi.fn<() => Promise<EnsureDirResult>>();
const dbUpsertThread = vi.fn<() => Promise<undefined>>(async () => undefined);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    ensureCampaignWorkspaceDir: ensureDir,
    dbUpsertThread,
  }),
}));

vi.mock("@/renderer/actions/resolveAgentAndModelForCampaign", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    resolveAgentAndModelForCampaign: () => ({ agentKind: "claude", model: "claude-sonnet-5" }),
  };
});

describe("ensureCampaignsHubProject", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureDir.mockReset();
    dbUpsertThread.mockClear();
  });

  it("shares one in-flight ensure between concurrent submits (no duplicate hubs)", async () => {
    // Hold the workspace-dir IPC open so both callers land inside the window
    // that previously produced two persisted hub projects.
    let release: (value: EnsureDirResult) => void = () => {};
    ensureDir.mockImplementation(
      () =>
        new Promise<EnsureDirResult>((resolve) => {
          release = resolve;
        }),
    );

    const { ensureCampaignsHubProject } = await import("./ensureCampaignsHubProject");
    const { useAppStore } = await import("@/renderer/state/appStore");

    const first = ensureCampaignsHubProject();
    const second = ensureCampaignsHubProject();
    release({ location: { kind: "posix", path: "/tmp/hub" } });
    const [a, b] = await Promise.all([first, second]);

    expect(ensureDir).toHaveBeenCalledTimes(1);
    // Shared in-flight promise: both callers must resolve to the very same
    // outcome object, which is what guarantees a single creation attempt.
    expect(a).toBe(b);
    const hubs = useAppStore
      .getState()
      .projects.filter((p) => p.campaignExtension?.campaignGroupId === "poracode-campaigns-hub");
    expect(hubs.length).toBeLessThanOrEqual(1);
  });

  it("isCampaignsHubProject distinguishes the hub from real campaign projects", async () => {
    const { isCampaignsHubProject } = await import("./ensureCampaignsHubProject");
    const base = {
      id: "x",
      name: "GAA",
      location: { kind: "posix" as const, path: "/tmp/g" },
      createdAt: new Date().toISOString(),
      purpose: "campaign" as const,
    };
    expect(
      isCampaignsHubProject({
        ...base,
        campaignExtension: {
          campaignGroupId: "poracode-campaigns-hub",
          clientName: "—",
          campaignName: "Campaigns",
        },
      } as never),
    ).toBe(true);
    expect(
      isCampaignsHubProject({
        ...base,
        campaignExtension: {
          campaignGroupId: "b05a803b-27c4-4761-adbd-e4a101d102c6",
          clientName: "AIB",
          campaignName: "GAA",
        },
      } as never),
    ).toBe(false);
  });
});
