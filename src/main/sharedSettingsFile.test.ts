import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSharedSettingsFile, writeSharedSettingsFile } from "./sharedSettingsFile";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lightcode-settings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  }
});

describe("sharedSettingsFile", () => {
  it("writes and reads shared settings as readable JSON", () => {
    const settingsPath = join(makeTempDir(), "settings.json");
    writeSharedSettingsFile(settingsPath, {
      themeMode: "dark",
      terminalPosition: "right",
      commitGenProvider: "auto",
      commitGenModel: "",
      commitGenEffort: "",
      titleGenProvider: "auto",
      titleGenModel: "",
      titleGenEffort: "",
      conflictResolverProvider: "auto",
      conflictResolverModel: "",
      conflictResolverEffort: "",
      wslCommitGenProvider: "auto",
      wslCommitGenModel: "",
      wslCommitGenEffort: "",
      wslTitleGenProvider: "auto",
      wslTitleGenModel: "",
      wslTitleGenEffort: "",
      wslConflictResolverProvider: "auto",
      wslConflictResolverModel: "",
      wslConflictResolverEffort: "",
      agentSettings: {},
      hiddenModels: {},
      disabledAgents: [],
      acpRegistryInstalledAgents: {},
      agentInstances: {},
      collapseTerminalComposer: false,
      staleThreadUnloadMinutes: 20,
      autoArchiveDoneAfterDays: 7,
      scrollSpeed: 2,
      agentTerminalFontSize: 12,
      guiChatFontSize: 13,
      terminalPanelFontSize: 12,
      preventSleepWhileWorking: true,
      threadRemoveAction: "archive",
      newThreadMode: "page",
      autoShowTerminalPanel: true,
      gitReviewMode: "panel",
      providerConfigs: {},
      lastPresentationModeByAgent: {},
      editorLspEnabled: false,
      searchUseIgnoreFiles: true,
      searchExclude: {},
      disableCliHookPlugin: false,
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
      favoriteModels: [],
      recentModels: [],
      agentHookSupport: {},
    });

    expect(readSharedSettingsFile(settingsPath)).toEqual({
      themeMode: "dark",
      terminalPosition: "right",
      commitGenProvider: "auto",
      commitGenModel: "",
      commitGenEffort: "",
      titleGenProvider: "auto",
      titleGenModel: "",
      titleGenEffort: "",
      conflictResolverProvider: "auto",
      conflictResolverModel: "",
      conflictResolverEffort: "",
      wslCommitGenProvider: "auto",
      wslCommitGenModel: "",
      wslCommitGenEffort: "",
      wslTitleGenProvider: "auto",
      wslTitleGenModel: "",
      wslTitleGenEffort: "",
      wslConflictResolverProvider: "auto",
      wslConflictResolverModel: "",
      wslConflictResolverEffort: "",
      agentSettings: {},
      hiddenModels: {},
      disabledAgents: [],
      acpRegistryInstalledAgents: {},
      agentInstances: {},
      collapseTerminalComposer: false,
      staleThreadUnloadMinutes: 20,
      autoArchiveDoneAfterDays: 7,
      scrollSpeed: 2,
      agentTerminalFontSize: 12,
      guiChatFontSize: 13,
      terminalPanelFontSize: 12,
      preventSleepWhileWorking: true,
      threadRemoveAction: "archive",
      newThreadMode: "page",
      autoShowTerminalPanel: true,
      gitReviewMode: "panel",
      providerConfigs: {},
      lastPresentationModeByAgent: {},
      editorLspEnabled: false,
      searchUseIgnoreFiles: true,
      searchExclude: {},
      disableCliHookPlugin: false,
      notificationsEnabled: true,
      notificationSound: true,
      notificationFilter: "unfocused",
      notificationStatuses: { done: true, needsAttention: true, error: true },
      favoriteModels: [],
      recentModels: [],
      agentHookSupport: {},
    });
    expect(readFileSync(settingsPath, "utf8")).toContain('"themeMode": "dark"');
  });

  it("preserves valid settings when provider configs contain invalid entries", () => {
    const settingsPath = join(makeTempDir(), "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        themeMode: "dark",
        terminalPosition: "right",
        autoShowTerminalPanel: false,
        providerConfigs: {
          codex: {
            model: "",
            effort: "high",
          },
        },
      }),
      "utf8",
    );

    expect(readSharedSettingsFile(settingsPath)).toMatchObject({
      themeMode: "dark",
      terminalPosition: "right",
      autoShowTerminalPanel: false,
      providerConfigs: {},
    });
  });
});
