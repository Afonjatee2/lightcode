import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";

const execFileAsyncMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr?: string }>>(),
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const { promisify } = require("node:util") as typeof import("node:util");
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), {
      [promisify.custom]: execFileAsyncMock,
    }),
  };
});

import {
  buildAgentCommand,
  clearExecutablePathCache,
  cliSubcommandAuthProbe,
  primeExecutablePathCache,
  resolveExecutablePathAsync,
} from "./base";

const expectedShellArgs = (script: string) =>
  process.platform === "darwin" ? ["-l", "-i", "-c", script] : ["-l", "-c", script];

const posixProject: ProjectLocation = {
  kind: "posix",
  path: "/Users/demo/project",
};

describe.skipIf(process.platform === "win32")("POSIX login shell wrappers", () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    vi.clearAllMocks();
    clearExecutablePathCache();
    process.env.SHELL = "/bin/zsh";
  });

  afterAll(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }
  });

  it("resolves binaries through the user's login shell on POSIX", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: "direnv: loading ~/.envrc\n/Users/demo/.local/bin/claude\n",
      stderr: "",
    });

    await expect(resolveExecutablePathAsync("claude")).resolves.toBe(
      "/Users/demo/.local/bin/claude",
    );

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "/bin/zsh",
      expectedShellArgs("command -v 'claude'"),
      expect.objectContaining({
        cwd: homedir(),
        timeout: 5_000,
        windowsHide: true,
      }),
    );
  });

  it("wraps native launches in the user's login shell when the binary is unresolved", () => {
    expect(buildAgentCommand(posixProject, "claude", ["--version"])).toEqual({
      command: "/bin/zsh",
      args: expectedShellArgs("exec 'claude' '--version'"),
      cwd: "/Users/demo/project",
    });
  });

  it("spawns absolute binary paths directly with the user's captured shell env", async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: [
        "claude\t/Users/demo/.local/bin/claude",
        "__LIGHTCODE_ENV_BEGIN__",
        "PATH=/opt/homebrew/bin:/usr/bin:/bin",
        "NVM_DIR=/Users/demo/.nvm",
        "HOMEBREW_PREFIX=/opt/homebrew",
        "EDITOR=nvim",
        "PWD=/should/be/skipped",
        "SHLVL=1",
      ].join("\n"),
      stderr: "",
    });

    await primeExecutablePathCache(["claude"]);

    expect(
      buildAgentCommand(posixProject, "claude", ["--version"], "/Users/demo/.local/bin/claude"),
    ).toEqual({
      command: "/Users/demo/.local/bin/claude",
      args: ["--version"],
      cwd: "/Users/demo/project",
      env: {
        PATH: "/opt/homebrew/bin:/usr/bin:/bin",
        NVM_DIR: "/Users/demo/.nvm",
        HOMEBREW_PREFIX: "/opt/homebrew",
        EDITOR: "nvim",
      },
    });
  });

  it("prepends the project's pinned nvm node bin to PATH on direct spawn", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lightcode-nvm-spawn-"));
    const project = join(tmp, "project");
    const nvmDir = join(tmp, ".nvm");
    const nodeBin = join(nvmDir, "versions", "node", "v24.13.1", "bin");
    try {
      mkdirSync(project, { recursive: true });
      mkdirSync(nodeBin, { recursive: true });
      writeFileSync(join(project, ".nvmrc"), "24\n");

      execFileAsyncMock.mockResolvedValue({
        stdout: [
          "claude\t/Users/demo/.local/bin/claude",
          "__LIGHTCODE_ENV_BEGIN__",
          "PATH=/opt/homebrew/bin:/usr/bin:/bin",
          `NVM_DIR=${nvmDir}`,
        ].join("\n"),
        stderr: "",
      });

      await primeExecutablePathCache(["claude"]);

      const spec = buildAgentCommand(
        { kind: "posix", path: project },
        "claude",
        ["--version"],
        "/Users/demo/.local/bin/claude",
      );

      expect(spec.cwd).toBe(project);
      expect(spec.env?.PATH).toBe(`${nodeBin}:/opt/homebrew/bin:/usr/bin:/bin`);
      expect(spec.env?.NVM_DIR).toBe(nvmDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects the project nvm bin even when wrapping in a login shell", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lightcode-nvm-shell-"));
    const project = join(tmp, "project");
    const nvmDir = join(tmp, ".nvm");
    const nodeBin = join(nvmDir, "versions", "node", "v24.13.1", "bin");
    const originalNvmDir = process.env.NVM_DIR;
    try {
      mkdirSync(project, { recursive: true });
      mkdirSync(nodeBin, { recursive: true });
      writeFileSync(join(project, ".nvmrc"), "24\n");
      process.env.NVM_DIR = nvmDir;

      const spec = buildAgentCommand({ kind: "posix", path: project }, "claude", ["--version"]);

      expect(spec.command).toBe("/bin/zsh");
      expect(spec.args).toEqual(expectedShellArgs("exec 'claude' '--version'"));
      expect(spec.cwd).toBe(project);
      expect(spec.env?.PATH?.startsWith(`${nodeBin}:`)).toBe(true);
    } finally {
      if (originalNvmDir === undefined) delete process.env.NVM_DIR;
      else process.env.NVM_DIR = originalNvmDir;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs CLI auth probes via direct spawn", async () => {
    execFileAsyncMock.mockResolvedValueOnce({
      stdout: "Authenticated\n",
      stderr: "",
    });

    const probe = cliSubcommandAuthProbe(["auth", "status"]);

    await expect(
      probe({
        location: posixProject,
        executablePath: "/Users/demo/.nvm/versions/node/v24/bin/claude",
      }),
    ).resolves.toBe("authenticated");

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "/Users/demo/.nvm/versions/node/v24/bin/claude",
      ["auth", "status"],
      expect.objectContaining({
        cwd: "/Users/demo/project",
        timeout: 10_000,
        windowsHide: true,
      }),
    );
  });
});
