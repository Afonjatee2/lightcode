import { describe, expect, it } from "vitest";
import { resolveSharedUpdateCommand } from "./updateResolver";

const claudeUpdate = {
  builtIn: { binary: "claude", args: ["update"] },
  npm: "@anthropic-ai/claude-code",
  brew: "claude",
  winget: "Anthropic.ClaudeCode",
};

const codexUpdate = {
  builtIn: { binary: "codex", args: ["update"] },
  npm: "@openai/codex",
};

const geminiUpdate = {
  npm: "@google/gemini-cli",
  brew: "gemini-cli",
};

const cursorUpdate = {
  builtIn: { binary: "cursor-agent", args: ["update"] },
  homebrewCask: "cursor-cli",
};

const kimiUpdate = {
  npm: "@moonshot-ai/kimi-code",
  installer: {
    posix: {
      binary: "sh",
      args: ["-c", "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"],
    },
    windows: {
      binary: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
      ],
    },
  },
};

describe("resolveSharedUpdateCommand", () => {
  it("returns the provider's built-in updater when one is configured", () => {
    expect(
      resolveSharedUpdateCommand({
        update: claudeUpdate,
        executablePath: "/usr/local/bin/claude",
        envKind: "posix",
      }),
    ).toEqual({ binary: "claude", args: ["update"], strategy: "built-in" });
  });

  it("uses Codex's built-in updater before npm fallback", () => {
    expect(
      resolveSharedUpdateCommand({
        update: codexUpdate,
        executablePath: "/home/user/.local/share/pnpm/codex",
        envKind: "posix",
      }),
    ).toEqual({ binary: "codex", args: ["update"], strategy: "built-in" });
  });

  it("uses package-manager fallback when built-in updater is skipped", () => {
    expect(
      resolveSharedUpdateCommand({
        update: codexUpdate,
        executablePath: "/home/user/.local/share/pnpm/codex",
        envKind: "posix",
        skipBuiltIn: true,
      }),
    ).toEqual({
      binary: "pnpm",
      args: ["add", "-g", "@openai/codex@latest"],
      strategy: "pnpm-global",
    });
  });

  it("re-runs the provider install script (installer strategy) for posix and WSL", () => {
    for (const envKind of ["posix", "wsl"] as const) {
      expect(
        resolveSharedUpdateCommand({
          update: kimiUpdate,
          executablePath: "/home/user/.kimi-code/bin/kimi",
          envKind,
        }),
      ).toEqual({
        binary: "sh",
        args: ["-c", "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash"],
        strategy: "installer",
      });
    }
  });

  it("uses the Windows install script for the installer strategy on Windows", () => {
    expect(
      resolveSharedUpdateCommand({
        update: kimiUpdate,
        executablePath: "C:\\Users\\demo\\.kimi-code\\bin\\kimi.exe",
        envKind: "windows",
      }),
    ).toEqual({
      binary: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
      ],
      strategy: "installer",
    });
  });

  it("prefers a package manager over the installer when the binary lives in one", () => {
    // Installed via pnpm global → update through pnpm, not the curl installer.
    expect(
      resolveSharedUpdateCommand({
        update: kimiUpdate,
        executablePath: "/home/user/.local/share/pnpm/kimi",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "pnpm",
      args: ["add", "-g", "@moonshot-ai/kimi-code@latest"],
      strategy: "pnpm-global",
    });
  });

  it("prefers the installer over the npm last-resort for unrecognised install paths", () => {
    expect(
      resolveSharedUpdateCommand({
        update: kimiUpdate,
        executablePath: "/opt/custom/kimi",
        envKind: "posix",
      })?.strategy,
    ).toBe("installer");
  });

  it("uses pnpm-global when the executable lives under ~/.local/share/pnpm", () => {
    expect(
      resolveSharedUpdateCommand({
        update: geminiUpdate,
        executablePath: "/home/user/.local/share/pnpm/gemini",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "pnpm",
      args: ["add", "-g", "@google/gemini-cli@latest"],
      strategy: "pnpm-global",
    });
  });

  it("uses bun-global when the executable lives under ~/.bun/bin", () => {
    expect(
      resolveSharedUpdateCommand({
        update: geminiUpdate,
        executablePath: "/home/user/.bun/bin/gemini",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "bun",
      args: ["i", "-g", "@google/gemini-cli@latest"],
      strategy: "bun-global",
    });
  });

  it("uses npm-global when the executable lives under a node_modules tree", () => {
    expect(
      resolveSharedUpdateCommand({
        update: geminiUpdate,
        executablePath: "/usr/local/lib/node_modules/@google/gemini-cli/bin/gemini",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "npm",
      args: ["install", "-g", "@google/gemini-cli@latest"],
      strategy: "npm-global",
    });
  });

  it("uses brew when a formula-backed executable lives under Homebrew", () => {
    expect(
      resolveSharedUpdateCommand({
        update: geminiUpdate,
        executablePath: "/opt/homebrew/bin/gemini",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "brew",
      args: ["upgrade", "gemini-cli"],
      strategy: "brew",
    });
  });

  it("uses brew cask when a cask-backed executable lives under Homebrew", () => {
    expect(
      resolveSharedUpdateCommand({
        update: cursorUpdate,
        executablePath: "/opt/homebrew/bin/cursor-agent",
        envKind: "posix",
        skipBuiltIn: true,
      }),
    ).toEqual({
      binary: "brew",
      args: ["upgrade", "--cask", "cursor-cli"],
      strategy: "brew",
    });
  });

  it("does not guess a cask updater when the path is not Homebrew-managed", () => {
    expect(
      resolveSharedUpdateCommand({
        update: cursorUpdate,
        executablePath: "/home/user/.local/bin/cursor-agent",
        envKind: "posix",
        skipBuiltIn: true,
      }),
    ).toBeUndefined();
  });

  it("falls back to npm-global when path is unrecognised but provider publishes on npm", () => {
    expect(
      resolveSharedUpdateCommand({
        update: geminiUpdate,
        executablePath: "/some/random/place/gemini",
        envKind: "posix",
      }),
    ).toEqual({
      binary: "npm",
      args: ["install", "-g", "@google/gemini-cli@latest"],
      strategy: "npm-global",
    });
  });

  it("returns undefined when no update metadata is available", () => {
    expect(
      resolveSharedUpdateCommand({
        update: undefined,
        executablePath: "/opt/homemade/agent",
        envKind: "posix",
      }),
    ).toBeUndefined();
  });
});
