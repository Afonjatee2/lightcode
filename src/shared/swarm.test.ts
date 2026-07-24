import { describe, expect, it } from "vitest";
import { buildSwarmPrompt, type SwarmAgentSelection } from "./swarm";

const root: SwarmAgentSelection = {
  agentKind: "codex",
  agentLabel: "Codex",
  model: "gpt-5.6-sol",
  modelLabel: "GPT-5.6 Sol",
};

describe("buildSwarmPrompt", () => {
  it("pins the roster and preserves worktree and review gates", () => {
    const prompt = buildSwarmPrompt({
      task: "Build the billing page",
      projectName: "Lightcode",
      orchestrator: root,
      review: {
        mode: "dedicated",
        agent: {
          agentKind: "claude",
          agentLabel: "Claude",
          model: "claude-opus-4-8",
          modelLabel: "Opus 4.8",
        },
      },
      workers: [
        {
          agentKind: "qwen",
          agentLabel: "Qwen",
          model: "qwen3.8-max-preview",
          modelLabel: "Qwen3.8 Max Preview",
        },
        {
          agentKind: "commandcode",
          agentLabel: "Command Code",
          model: "deepseek-v4-pro",
          modelLabel: "DeepSeek V4 Pro",
        },
      ],
    });

    expect(prompt).toContain("provider=claude");
    expect(prompt).toContain("model=claude-opus-4-8");
    expect(prompt).toContain("create_thread, worktree=true");
    expect(prompt).toContain("qwen3.8-max-preview");
    expect(prompt).toContain("deepseek-v4-pro");
    expect(prompt).toContain("orchestration-only");
    expect(prompt).toContain("do not implement repository changes in the root checkout");
    expect(prompt).toContain("Never merge, cherry-pick, squash");
    expect(prompt).toContain("VERDICT: SHIP, REVISE, or REJECT");
  });

  it("keeps review in the root when the selections match", () => {
    const prompt = buildSwarmPrompt({
      task: "Fix the parser",
      projectName: "Demo",
      orchestrator: root,
      review: { mode: "root" },
      workers: [root, { ...root, model: "gpt-5.6-terra", modelLabel: "GPT-5.6 Terra" }],
    });

    expect(prompt).toContain("review directly as the root");
    expect(prompt).toContain("Do not create a reviewer child");
    expect(prompt).toContain("Review every worker diff yourself");
  });

  it("supports a lean swarm with one implementation worker and one reviewer", () => {
    const prompt = buildSwarmPrompt({
      task: "Fix the parser",
      projectName: "Demo",
      orchestrator: root,
      review: {
        mode: "dedicated",
        agent: { ...root, agentKind: "claude", agentLabel: "Claude" },
      },
      workers: [{ ...root, agentKind: "qwen", agentLabel: "Qwen" }],
    });

    expect(prompt).toContain("Decompose the task into 1 bounded work item, one per worker.");
    expect(prompt).toContain("provider=claude");
    expect(prompt).toContain("launch exactly one visible reviewer child");
    expect(prompt).toContain("worktree=false");
    expect(prompt).toContain("Workers:\n1. Qwen");
  });

  it("requires attached context to be inspected and distributed safely", () => {
    const prompt = buildSwarmPrompt({
      task: "Implement the brief",
      projectName: "Demo",
      orchestrator: root,
      review: { mode: "root" },
      workers: [root, { ...root, model: "gpt-5.6-terra", modelLabel: "GPT-5.6 Terra" }],
      attachmentCount: 3,
    });

    expect(prompt).toContain("Attached context: 3 user-supplied file(s)");
    expect(prompt).toContain("inspect every one before decomposing the task");
    expect(prompt).toContain(".poracode/attachments");
    expect(prompt).toContain("keep it untracked");
  });
});
