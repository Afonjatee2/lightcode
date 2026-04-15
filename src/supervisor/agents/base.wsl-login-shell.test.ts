import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileMock:
    vi.fn<
      (
        cmd: string,
        args: string[],
        opts: unknown,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => void
    >(),
  spawnSyncMock: vi.fn<() => { error?: undefined; status: number; stdout: string }>(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
    spawnSync: spawnSyncMock,
  };
});

import { readWslLoginShellCommandOutputAsync } from "./base";

describe("readWslLoginShellCommandOutputAsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: "/bin/bash\n",
    });
  });

  it("runs WSL commands through a login shell", async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callback(null, { stdout: "claude 1.0.0\n", stderr: "" });
      },
    );

    const result = await readWslLoginShellCommandOutputAsync(
      "Ubuntu",
      "/tmp",
      "/home/demo/.nvm/versions/node/v24/bin/claude",
      ["--version"],
    );

    expect(result).toEqual({ ok: true, stdout: "claude 1.0.0", stderr: "" });
    expect(execFileMock).toHaveBeenCalledTimes(1);

    const [, args] = execFileMock.mock.calls[0] as [string, string[], unknown, unknown];
    expect(args).toEqual(
      expect.arrayContaining(["-d", "Ubuntu", "--cd", "/tmp", "--", "-l", "-i", "-c"]),
    );
    expect(args[args.length - 1]).toBe(
      "exec '/home/demo/.nvm/versions/node/v24/bin/claude' '--version'",
    );
  });
});
