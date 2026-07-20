// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_EXPERIMENT_PROMPT_LENGTH, type ProjectLocation } from "@/shared/contracts";
import type { AgentAdapter } from "./agents/base";
import { cleanSpec, generateExecutorSpec } from "./executorSpecGenerator";

const location: ProjectLocation = { kind: "native", path: "/tmp/repo" };

function fakeAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    label: "Fake",
    defaultOneShotModel: "fake-model",
    runOneShot: async () => "spec body",
    ...overrides,
  } as unknown as AgentAdapter;
}

describe("cleanSpec", () => {
  it("strips <think> reasoning blocks", () => {
    expect(cleanSpec("<think>reasoning here</think>\n# Task\nDo the thing")).toBe(
      "# Task\nDo the thing",
    );
  });

  it("unwraps a single enclosing code fence", () => {
    expect(cleanSpec("```markdown\n# Task\nDo the thing\n```")).toBe("# Task\nDo the thing");
  });

  it("keeps inner fences and multi-section content intact", () => {
    const spec = "# Task\n\n```ts\nconst x = 1;\n```\n\n# Done";
    expect(cleanSpec(spec)).toBe(spec);
  });

  it("caps length at MAX_EXPERIMENT_PROMPT_LENGTH", () => {
    const cleaned = cleanSpec("x".repeat(MAX_EXPERIMENT_PROMPT_LENGTH + 500));
    expect(cleaned.length).toBeLessThanOrEqual(MAX_EXPERIMENT_PROMPT_LENGTH);
    expect(cleaned.endsWith("[spec truncated]")).toBe(true);
  });
});

describe("generateExecutorSpec", () => {
  it("returns the cleaned spec from the adapter's one-shot", async () => {
    const spec = await generateExecutorSpec(
      location,
      fakeAdapter({ runOneShot: async () => "<think>x</think>\n# Task\nDo it" }),
      "fix the thing",
    );
    expect(spec).toBe("# Task\nDo it");
  });

  it("throws when no model is available", async () => {
    await expect(
      generateExecutorSpec(location, fakeAdapter({ defaultOneShotModel: undefined }), "task"),
    ).rejects.toThrow(/No default one-shot model/);
  });

  it("throws when the adapter cannot run a one-shot", async () => {
    await expect(
      generateExecutorSpec(
        location,
        fakeAdapter({ runOneShot: undefined, buildOneShotCommand: undefined }),
        "task",
      ),
    ).rejects.toThrow(/does not support one-shot/);
  });
});
