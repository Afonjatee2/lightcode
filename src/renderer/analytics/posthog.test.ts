import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeState = vi.hoisted(() => ({
  bridge: {
    appVersion: "0.1.7",
    arch: "arm64",
    chromeVersion: "125",
    electronVersion: "35",
    isDev: false,
    nodeVersion: "24",
    platform: "darwin",
    posthogEnableDev: false,
    posthogEnabled: true,
    posthogHost: "https://posthog.test",
    posthogKey: "phc_test",
    sentryEnabled: false,
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeState.bridge,
}));

function parseBatchBody(
  fetchMock: { mock: { calls: Array<Parameters<typeof fetch>> } },
  index: number,
) {
  const request = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(request?.body)) as {
    batch: Array<{ event: string; properties: Record<string, unknown> }>;
  };
}

describe("posthog product analytics sender", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    bridgeState.bridge.posthogKey = "phc_test";
    bridgeState.bridge.posthogHost = "https://posthog.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send when PostHog is disabled", async () => {
    bridgeState.bridge.posthogKey = "";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { captureProductEvent, flushProductAnalytics } = await import("./posthog");

    captureProductEvent("thread.started", { provider: "codex" });
    await flushProductAnalytics();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a single in-flight flush", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { captureProductEvent, flushProductAnalytics } = await import("./posthog");

    captureProductEvent("thread.started", { provider: "codex" });
    const first = flushProductAnalytics();
    const second = flushProductAnalytics();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(new Response("{}", { status: 200 }));
    await Promise.all([first, second]);
  });

  it("retries failed batches before newer events", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { captureProductEvent, flushProductAnalytics } = await import("./posthog");

    captureProductEvent("git.sync_action", { action: "first" });
    await flushProductAnalytics();
    captureProductEvent("git.sync_action", { action: "second" });
    await flushProductAnalytics();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(parseBatchBody(fetchMock, 1).batch.map((event) => event.properties.action)).toEqual([
      "first",
      "second",
    ]);
  });
});
