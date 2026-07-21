// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_EXPERIMENT_PROMPT_LENGTH, type ProjectLocation } from "@/shared/contracts";
import type { AgentAdapter } from "./agents/base";
import { cleanSpec, generateExecutorSpec } from "./executorSpecGenerator";

const location: ProjectLocation = { kind: "posix", path: "/tmp/repo" };

function fakeAdapter(overrides: Record<string, unknown> = {}): AgentAdapter {
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

  it("keeps only the final message from a codex exec transcript", () => {
    const finalSpec = [
      "# Task",
      "Fix the homepage heading in src/home.tsx.",
      "",
      "## Implementation requirements",
      "1. Update the <h1> copy in src/home.tsx.",
    ].join("\n");
    const transcript = [
      "OpenAI Codex v0.144.6",
      "--------",
      "workdir: /Users/dev/AAL_SEO",
      "model: gpt-5.6-sol",
      "provider: openai",
      "approval: never",
      "sandbox: read-only",
      "reasoning effort: high",
      "session id: 019f0000-0000-0000-0000-000000000000",
      "--------",
      "user",
      'You are a senior engineer writing a precise implementation spec for an autonomous coding agent (the "executor").',
      "Task:",
      "Fix the homepage heading",
      "--------",
      "codex",
      "I'll inspect the homepage first.",
      "--------",
      "codex",
      finalSpec,
    ].join("\n");

    expect(cleanSpec(transcript)).toBe(finalSpec);
  });

  it("unwraps a code fence inside the final codex message", () => {
    const transcript = [
      "OpenAI Codex v0.144.6",
      "--------",
      "user",
      "draft the spec",
      "--------",
      "codex",
      "```markdown",
      "# Task",
      "Do the thing",
      "```",
    ].join("\n");

    expect(cleanSpec(transcript)).toBe("# Task\nDo the thing");
  });

  it("leaves a normal spec containing dashes and the word user intact", () => {
    const spec = [
      "# Task",
      "Update the user profile flow.",
      "",
      "----",
      "",
      "## Notes",
      "The user asked for a horizontal rule above; keep it.",
    ].join("\n");
    expect(cleanSpec(spec)).toBe(spec);
  });

  it("does not treat a spec mentioning a codex turn marker as a transcript", () => {
    const spec = ["# Task", "Parse the line that reads", "codex", "and keep it."].join("\n");
    expect(cleanSpec(spec)).toBe(spec);
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

  it("surfaces attachments to the drafting prompt as @path references", async () => {
    let capturedPrompt = "";
    const adapter = fakeAdapter({
      runOneShot: async (input: { prompt: string }) => {
        capturedPrompt = input.prompt;
        return "spec body";
      },
    });
    await generateExecutorSpec(
      location,
      adapter,
      "fix the thing",
      undefined,
      undefined,
      undefined,
      undefined,
      [
        { path: "/tmp/spec-assets/design.png", mimeType: "image/png" },
        { path: "/tmp/spec-assets/notes.md" },
      ],
    );
    expect(capturedPrompt).toContain("The user attached these files");
    expect(capturedPrompt).toContain("@/tmp/spec-assets/design.png");
    expect(capturedPrompt).toContain("@/tmp/spec-assets/notes.md");
  });

  it("omits the attachment section when no attachments are provided", async () => {
    let capturedPrompt = "";
    const adapter = fakeAdapter({
      runOneShot: async (input: { prompt: string }) => {
        capturedPrompt = input.prompt;
        return "spec body";
      },
    });
    await generateExecutorSpec(location, adapter, "fix the thing");
    expect(capturedPrompt).not.toContain("The user attached these files");
    expect(capturedPrompt).toContain("Task:\nfix the thing");
  });
});
