import { homedir } from "node:os";
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

  it("wraps native launches in the user's login shell", () => {
    expect(buildAgentCommand(posixProject, "claude", ["--version"])).toEqual({
      command: "/bin/zsh",
      args: expectedShellArgs("exec 'claude' '--version'"),
      cwd: "/Users/demo/project",
    });
  });

  it("runs CLI auth probes through the same login-shell wrapper", async () => {
    execFileAsyncMock.mockResolvedValue({
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
      "/bin/zsh",
      expectedShellArgs("exec '/Users/demo/.nvm/versions/node/v24/bin/claude' 'auth' 'status'"),
      expect.objectContaining({
        cwd: "/Users/demo/project",
        timeout: 10_000,
        windowsHide: true,
      }),
    );
  });
});
