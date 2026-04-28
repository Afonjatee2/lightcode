import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getGeminiPluginPaths,
  installGeminiPlugin,
  isGeminiPluginInstalled,
  renderGeminiSettings,
} from "./install";

const tempDirs: string[] = [];

function makeBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lightcode-gemini-plugin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("getGeminiPluginPaths", () => {
  it("places Gemini settings under Lightcode's plugin dir", () => {
    const baseDir = makeBaseDir();
    const paths = getGeminiPluginPaths({ envKind: "posix", baseDir });

    expect(paths.pluginDir).toBe(join(baseDir, "agent-plugins", "gemini"));
    expect(paths.settingsPath).toBe(join(baseDir, "agent-plugins", "gemini", "settings.json"));
  });
});

describe("renderGeminiSettings", () => {
  it("renders WSL hook entries with the resolved-node command prefix", () => {
    const commandPrefix =
      "'/home/demo/.nvm/versions/node/v22.11.0/bin/node' '/home/demo/.lightcode/agent-plugins/gemini/forward.mjs'";
    const doc = renderGeminiSettings(commandPrefix);

    expect(doc.hooksConfig).toEqual({ notifications: false });
    expect(Object.keys(doc.hooks)).toEqual([
      "SessionStart",
      "BeforeAgent",
      "BeforeModel",
      "BeforeTool",
      "AfterTool",
      "AfterAgent",
      "Notification",
    ]);
    expect(doc.hooks.BeforeTool?.[0]).toMatchObject({ matcher: "*" });
    expect(doc.hooks.AfterTool?.[0]).toMatchObject({ matcher: "*" });
    expect(doc.hooks.SessionStart?.[0]?.matcher).toBeUndefined();
    expect(doc.hooks.AfterAgent?.[0]?.hooks[0]).toMatchObject({
      name: "lightcode-status-AfterAgent",
      type: "command",
      command: `${commandPrefix} AfterAgent`,
      timeout: 5000,
    });
  });
});

describe("installGeminiPlugin", () => {
  it("stages assets and writes a private Gemini system settings file", () => {
    const baseDir = makeBaseDir();

    const result = installGeminiPlugin({ envKind: "posix", baseDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(join(result.paths.pluginDir, "plugin.json"))).toBe(true);
    expect(existsSync(join(result.paths.pluginDir, "forward.mjs"))).toBe(true);
    expect(existsSync(result.paths.settingsPath)).toBe(true);
    expect(isGeminiPluginInstalled({ envKind: "posix", baseDir })).toMatchObject({
      installed: true,
      version: "1.1.0",
    });

    const settings = JSON.parse(readFileSync(result.paths.settingsPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(settings.hooks.Notification?.[0]?.hooks[0]?.command).toMatch(
      /agent-plugins[\\/]+gemini[\\/]+lightcode-hook\.(?:sh|cmd)/,
    );
  });
});
