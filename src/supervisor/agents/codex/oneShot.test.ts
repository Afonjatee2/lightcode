// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  unlinkSync: vi.fn<(path: string) => void>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: fsMocks.readFileSync,
    unlinkSync: fsMocks.unlinkSync,
  };
});

type SpawnFn = (
  spec: unknown,
  input: string,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<string>;

const spawnMocks = vi.hoisted(() => ({
  spawn: vi.fn<SpawnFn>(),
  prepareOneShot: vi.fn<(location: unknown, cmd: unknown) => { spec: unknown; spawn: SpawnFn }>(),
}));

vi.mock("../../oneShotSpawn", () => ({
  prepareOneShot: spawnMocks.prepareOneShot,
}));

import { buildCodexOneShotArgs, runCodexOneShot } from "./oneShot";

const location: ProjectLocation = { kind: "posix", path: "/tmp/repo" };

const FINAL_SPEC = ["# Task", "Fix the homepage heading in src/home.tsx."].join("\n");

const TRANSCRIPT = [
  "OpenAI Codex v0.144.6",
  "--------",
  "workdir: /Users/dev/AAL_SEO",
  "model: gpt-5.6-sol",
  "--------",
  "user",
  "You are a senior engineer writing a precise implementation spec.",
  "--------",
  "codex",
  FINAL_SPEC,
].join("\n");

describe("buildCodexOneShotArgs", () => {
  it("reads the prompt from stdin and omits the last-message flag when unused", () => {
    expect(buildCodexOneShotArgs("gpt-5.5", undefined)).toEqual([
      "exec",
      "--skip-git-repo-check",
      "-m",
      "gpt-5.5",
      "-",
    ]);
  });

  it("adds --output-last-message and reasoning effort when supplied", () => {
    expect(buildCodexOneShotArgs("gpt-5.5", "low", "/tmp/last.md")).toEqual([
      "exec",
      "--skip-git-repo-check",
      "-m",
      "gpt-5.5",
      "--output-last-message",
      "/tmp/last.md",
      "-c",
      'model_reasoning_effort="low"',
      "-",
    ]);
  });
});

describe("runCodexOneShot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMocks.prepareOneShot.mockReturnValue({
      spec: { command: "codex", args: [] },
      spawn: spawnMocks.spawn,
    });
  });

  it("returns only codex's final message from the --output-last-message file", async () => {
    spawnMocks.spawn.mockResolvedValue(TRANSCRIPT);
    fsMocks.readFileSync.mockReturnValue(`  ${FINAL_SPEC}  `);

    await expect(
      runCodexOneShot({ location, model: "gpt-5.6-sol", effort: "high", prompt: "draft" }),
    ).resolves.toBe(FINAL_SPEC);

    // The spawn must request the final-message file, not rely on stdout.
    const cmd = spawnMocks.prepareOneShot.mock.calls[0]?.[1] as {
      command: string;
      args: string[];
    };
    expect(cmd.command).toBe("codex");
    expect(cmd.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "-m",
      "gpt-5.6-sol",
      "--output-last-message",
      expect.any(String),
      "-c",
      'model_reasoning_effort="high"',
      "-",
    ]);
    // The prompt is delivered on stdin, keeping argv tiny.
    expect(spawnMocks.spawn).toHaveBeenCalledWith(
      expect.anything(),
      "draft",
      expect.any(Number),
      undefined,
    );
    // The temp file is cleaned up on the native path.
    expect(fsMocks.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to extracting the final message from the transcript when the file is missing", async () => {
    spawnMocks.spawn.mockResolvedValue(TRANSCRIPT);
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await expect(
      runCodexOneShot({ location, model: "gpt-5.6-sol", prompt: "draft" }),
    ).resolves.toBe(FINAL_SPEC);
  });

  it("falls back to the transcript when the last-message file is empty", async () => {
    spawnMocks.spawn.mockResolvedValue(TRANSCRIPT);
    fsMocks.readFileSync.mockReturnValue("   \n  ");

    await expect(
      runCodexOneShot({ location, model: "gpt-5.6-sol", prompt: "draft" }),
    ).resolves.toBe(FINAL_SPEC);
  });
});
