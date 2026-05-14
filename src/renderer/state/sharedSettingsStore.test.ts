import { beforeEach, describe, expect, it } from "vitest";
import { useSharedSettings } from "./sharedSettingsStore";

describe("sharedSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSharedSettings.setState({
      themeMode: "dark",
      staleThreadUnloadMinutes: 20,
      providerConfigs: {},
    });
  });

  it("defaults theme to dark", () => {
    expect(useSharedSettings.getState().themeMode).toBe("dark");
  });

  it("switches theme mode", () => {
    useSharedSettings.getState().setThemeMode("light");
    expect(useSharedSettings.getState().themeMode).toBe("light");
  });

  it("updates the stale thread unload timing", () => {
    useSharedSettings.getState().setStaleThreadUnloadMinutes(30);
    expect(useSharedSettings.getState().staleThreadUnloadMinutes).toBe(30);
  });

  it("updates provider config when only context size, fast, and thinking change", () => {
    useSharedSettings.getState().setProviderConfig("claude", {
      model: "claude-opus-4-7",
      effort: "high",
      contextSize: "1m",
      mode: "agent",
      approvalPolicy: "auto",
    });

    useSharedSettings.getState().setProviderConfig("claude", {
      model: "claude-opus-4-7",
      effort: "high",
      contextSize: "200k",
      fast: true,
      thinking: true,
      mode: "agent",
      approvalPolicy: "auto",
    });

    expect(useSharedSettings.getState().providerConfigs.claude).toMatchObject({
      contextSize: "200k",
      fast: true,
      thinking: true,
    });
  });
});
