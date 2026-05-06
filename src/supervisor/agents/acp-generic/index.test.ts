import { describe, expect, it } from "vitest";
import type { AgentInstanceConfig } from "@/shared/contracts";
import {
  ACP_GENERIC_KIND_PREFIX,
  createAcpGenericAdapter,
  extractAcpGenericInstanceId,
  isAcpGenericKind,
} from ".";

/**
 * The acp-generic adapter is the proof-point that any ACP-speaking binary
 * plugs into chat mode without provider-specific code. These tests verify
 * that an `AgentInstanceConfig` produces a well-formed `AgentAdapter` whose
 * kind, label, and capability declarations route correctly through the
 * registry — without spawning the real binary.
 */

const baseInstance: AgentInstanceConfig = {
  id: "my-acp",
  driver: "acp-generic",
  displayName: "My Custom ACP",
  config: {
    binary: "my-acp",
    args: ["--stdio"],
    cwd: "project",
    authMode: "none",
  },
};

describe("createAcpGenericAdapter", () => {
  it("produces a chat-only adapter with a namespaced kind", () => {
    const adapter = createAcpGenericAdapter(baseInstance);
    expect(adapter.kind).toBe("acp-generic:my-acp");
    expect(adapter.label).toBe("My Custom ACP");
    expect(adapter.capabilities.presentationModes).toEqual(["gui"]);
    expect(adapter.capabilities.liveInputMode).toBe("server");
    // No PTY launch path — generic ACP is structured-only.
    expect(typeof adapter.createStructuredSession).toBe("function");
  });

  it("falls back to the binary as a label when displayName is omitted", () => {
    const adapter = createAcpGenericAdapter({ ...baseInstance, displayName: undefined });
    expect(adapter.label).toBe("my-acp");
  });

  it("merges user-declared capability overrides into the default capability set", () => {
    const adapter = createAcpGenericAdapter({
      ...baseInstance,
      config: {
        ...(baseInstance.config as Record<string, unknown>),
        capabilities: { models: ["x-1", "x-2"], modes: ["agent", "plan"] },
      },
    });
    expect(adapter.capabilities.models).toEqual([
      { id: "x-1", label: "x-1" },
      { id: "x-2", label: "x-2" },
    ]);
    expect(adapter.capabilities.modes).toEqual(["agent", "plan"]);
  });

  it("envVar auth resolves authState from process.env at detection time", async () => {
    const key = "__LIGHTCODE_ACP_GENERIC_TEST__";
    delete process.env[key];
    const adapterMissing = createAcpGenericAdapter({
      ...baseInstance,
      config: {
        ...(baseInstance.config as Record<string, unknown>),
        authMode: "envVar",
        authEnvVar: key,
      },
    });
    const missingStatus = await adapterMissing.detectInstall();
    expect(missingStatus.authState).toBe("missing");

    process.env[key] = "secret";
    try {
      const adapterAuthed = createAcpGenericAdapter({
        ...baseInstance,
        config: {
          ...(baseInstance.config as Record<string, unknown>),
          authMode: "envVar",
          authEnvVar: key,
        },
      });
      const authedStatus = await adapterAuthed.detectInstall();
      expect(authedStatus.authState).toBe("authenticated");
    } finally {
      delete process.env[key];
    }
  });
});

describe("acp-generic kind helpers", () => {
  it("isAcpGenericKind matches namespaced kinds only", () => {
    expect(isAcpGenericKind(`${ACP_GENERIC_KIND_PREFIX}foo`)).toBe(true);
    expect(isAcpGenericKind("codex")).toBe(false);
  });

  it("extractAcpGenericInstanceId pulls the id back out", () => {
    expect(extractAcpGenericInstanceId(`${ACP_GENERIC_KIND_PREFIX}foo`)).toBe("foo");
    expect(extractAcpGenericInstanceId("codex")).toBeUndefined();
  });
});
