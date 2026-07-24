export interface SwarmAgentSelection {
  agentKind: string;
  agentLabel: string;
  model: string;
  modelLabel: string;
}

export type SwarmReviewSelection =
  | { mode: "root" }
  | { mode: "dedicated"; agent: SwarmAgentSelection };

export interface BuildSwarmPromptInput {
  task: string;
  projectName: string;
  orchestrator: SwarmAgentSelection;
  review: SwarmReviewSelection;
  workers: readonly SwarmAgentSelection[];
  attachmentCount?: number;
}

function describeAgent(agent: SwarmAgentSelection): string {
  return `${agent.agentLabel} (${agent.agentKind}) / ${agent.modelLabel} (${agent.model})`;
}

/**
 * Trusted operating contract for a Crossagents-backed swarm root. The task is
 * delimited as user data so repository text cannot weaken the isolation and
 * review gates encoded here.
 */
export function buildSwarmPrompt(input: BuildSwarmPromptInput): string {
  const workers = input.workers
    .map((worker, index) => `${index + 1}. ${describeAgent(worker)}`)
    .join("\n");
  const workItems =
    input.workers.length === 1
      ? "1 bounded work item"
      : `${input.workers.length} bounded work items`;
  const reviewer = input.review.mode === "root" ? input.orchestrator : input.review.agent;
  const reviewerIsRoot = input.review.mode === "root";

  return [
    "You are the root orchestrator and final code-review gate for a Tee's Cockpit agent swarm.",
    "You are orchestration-only: do not implement repository changes in the root checkout. Delegate all implementation work to the configured child workers.",
    `Project: ${input.projectName}`,
    `Root orchestrator: ${describeAgent(input.orchestrator)}`,
    `Reviewer: ${describeAgent(reviewer)}`,
    `Reviewer mode: ${reviewerIsRoot ? "review directly as the root" : "delegate the final review to the configured reviewer"}`,
    `Workers:\n${workers}`,
    ...(input.attachmentCount
      ? [`Attached context: ${input.attachmentCount} user-supplied file(s).`]
      : []),
    "",
    "<<<BEGIN USER TASK>>>",
    input.task.trim(),
    "<<<END USER TASK>>>",
    "",
    "Operating contract:",
    "1. Call list_agents, then get_agent for every configured provider. Use the exact provider and model IDs above. If one is unavailable, stop before editing and report exactly which selection is missing. Your first implementation action must be delegation, never an edit in the root checkout.",
    "2. Read the repository's AGENTS.md and relevant project instructions, inspect git status, and preserve all pre-existing user changes.",
    "3. If context files are attached, inspect every one before decomposing the task. Summarize the relevant evidence in each child prompt. If a worker must inspect a binary directly, stage a copy inside that worker's worktree under .poracode/attachments and keep it untracked unless the task explicitly requires committing it.",
    `4. Decompose the task into ${workItems}, one per worker. Prefer independent ownership of different files or modules. If clean separation is impossible, give workers distinct implementation, testing, investigation, or documentation responsibilities and state the dependency order explicitly.`,
    `5. Launch exactly ${input.workers.length} implementation worker ${input.workers.length === 1 ? "thread" : "threads"} with create_thread, worktree=true: one for each configured worker above, no more and no fewer. Use each configured provider/model exactly once, with a short title and a self-contained prompt. Tell each worker its owned files/responsibility, that other workers are active, and never to revert changes it did not create. Do not launch extra implementation or reviewer threads outside this roster.`,
    "6. Start independent children before waiting. Use wait_for_thread with the active thread IDs, collect each final result, and inspect every worktree's actual git diff and test output. Do not accept a worker's summary as proof.",
    reviewerIsRoot
      ? "7. Do not create a reviewer child. Review every worker diff yourself for correctness, regressions, security, tests, scope, and repository conventions. Give each work item VERDICT: SHIP, REVISE, or REJECT with concrete findings."
      : `7. After collecting worktree paths and branches, launch exactly one visible reviewer child with create_thread, worktree=false, provider=${reviewer.agentKind}, and model=${reviewer.model}. Give it the original task plus every exact worktree path and require direct diff inspection. Do not use an ephemeral reviewer. It must return VERDICT: SHIP, REVISE, or REJECT for each work item with concrete findings.`,
    "8. For a REVISE verdict, send one focused correction turn to that same child thread, wait for it, and review the resulting diff again. Never repair a worker's branch or implement task changes in the root checkout.",
    "9. Never merge, cherry-pick, squash, delete a worktree, delete a branch, push, or open a pull request. The human owns harvesting. Leave all child threads and worktrees available in the app.",
    "10. Finish with a compact report: work item, worker/model, branch, worktree path, files changed, tests run, final verdict, and any integration order or conflicts. Clearly distinguish verified facts from recommendations.",
  ].join("\n");
}
