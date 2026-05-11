import { describe, expect, it } from "vitest";
import { resolveFirstClassRegistryAgentKind } from "./acpRegistry";

describe("ACP registry first-class mapping", () => {
  it("routes known registry agents through built-in adapters", () => {
    expect(resolveFirstClassRegistryAgentKind("codex-acp")).toBe("codex");
    expect(resolveFirstClassRegistryAgentKind("cursor")).toBe("cursor");
    expect(resolveFirstClassRegistryAgentKind("opencode")).toBe("opencode");
  });

  it("leaves unknown registry agents for the generic ACP adapter", () => {
    expect(resolveFirstClassRegistryAgentKind("agoragentic-acp")).toBeUndefined();
  });
});
