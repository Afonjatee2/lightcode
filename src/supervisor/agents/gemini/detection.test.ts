import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";

const buildAgentCommandMock = vi.hoisted(() =>
  vi.fn<
    (
      location: ProjectLocation,
      command: string,
      args: string[],
      executablePath?: string,
    ) => { command: string; args: string[] }
  >(),
);
const probeAcpCapabilitiesMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);

vi.mock("../base", async () => {
  const actual = await vi.importActual<typeof import("../base")>("../base");
  return {
    ...actual,
    buildAgentCommand: buildAgentCommandMock,
  };
});

vi.mock("../acp", () => ({
  probeAcpCapabilities: probeAcpCapabilitiesMock,
}));

import { geminiDetectionSpec, parseGeminiGoogleAccountsJson } from "./detection";

describe("geminiDetectionSpec", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAgentCommandMock.mockReturnValue({
      command: "/bin/zsh",
      args: ["-l", "-c", "exec '/Users/demo/.local/bin/gemini' '--acp'"],
    });
    probeAcpCapabilitiesMock.mockResolvedValue(undefined);
  });

  it("uses the native project location and resolved executable for non-WSL probes", async () => {
    const location: ProjectLocation = { kind: "posix", path: "/Users/demo/project" };

    await expect(
      geminiDetectionSpec.capabilitiesProbe?.({
        location,
        executablePath: "/Users/demo/.local/bin/gemini",
      }),
    ).resolves.toBeUndefined();

    expect(buildAgentCommandMock).toHaveBeenCalledWith(location, "/Users/demo/.local/bin/gemini", [
      "--acp",
    ]);
    expect(probeAcpCapabilitiesMock).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-l", "-c", "exec '/Users/demo/.local/bin/gemini' '--acp'"],
      expect.any(String),
      expect.objectContaining({
        label: "gemini:posix",
        timeoutMs: 15_000,
      }),
    );
  });
});

describe("parseGeminiGoogleAccountsJson", () => {
  it("returns the active account email", () => {
    expect(
      parseGeminiGoogleAccountsJson(
        JSON.stringify({ active: "user@gmail.com", old: ["other@gmail.com"] }),
      ),
    ).toBe("user@gmail.com");
  });

  it("returns undefined when no active account is set", () => {
    expect(parseGeminiGoogleAccountsJson(JSON.stringify({ old: [] }))).toBeUndefined();
    expect(parseGeminiGoogleAccountsJson(JSON.stringify({ active: "" }))).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseGeminiGoogleAccountsJson("not json")).toBeUndefined();
  });
});
