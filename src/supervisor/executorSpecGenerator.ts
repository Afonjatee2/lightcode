import {
  MAX_EXPERIMENT_PROMPT_LENGTH,
  type ExecutorSpecAttachment,
  type ProjectLocation,
} from "@/shared/contracts";
import { extractFinalAgentMessage } from "./agentTranscript";
import type { AgentAdapter } from "./agents/base";
import { defaultFormatPromptSegments } from "./agents/base/promptSession";
import { runOneShotPromptWithFallback } from "./oneShotPromptRunner";

// A one-line task expands into a full spec, so allow a generous input but still
// cap it — the executor spec, not the task, is the long artifact.
const MAX_TASK_CHARS = 8_000;
// Drafting a full spec (optionally reading the repo read-only) takes longer than
// a title, so give it a roomy deadline.
const SPEC_GEN_TIMEOUT_MS = 120_000;

/**
 * Instruction that turns a short task into a complete, executor-ready spec. The
 * executor implements ONLY what the spec says, in an isolated worktree, and
 * never sees this drafting prompt — so the spec must be self-contained. The
 * relative-path rule mirrors the worktree-isolation lesson (an absolute repo
 * path in the prompt is what lets an autonomous agent escape its worktree).
 */
function buildPrompt(
  task: string,
  language?: string,
  attachments?: readonly ExecutorSpecAttachment[],
): string {
  const languageRule = language
    ? `- Write the spec in ${language}.\n`
    : "- Write the spec in the same language as the task below.\n";
  const trimmedTask = task.trim();
  const taskSection = trimmedTask ? `Task:\n${trimmedTask}\n` : "";
  return (
    'You are a senior engineer writing a precise implementation spec for an autonomous coding agent (the "executor").\n' +
    "The executor implements ONLY what your spec says, working in an isolated git worktree, and will NOT see this drafting prompt.\n" +
    "You may read the repository (read-only) to ground the spec in real file and symbol names. Then produce a complete, unambiguous executor spec for the task below.\n\n" +
    "Rules:\n" +
    "- The executor works in its CURRENT directory using RELATIVE paths only; never hardcode an absolute repository path.\n" +
    "- Structure the spec as markdown with clear sections: Task; Context / current behaviour; Implementation requirements (numbered; name specific files/functions when you can infer them); Constraints (what must NOT change); Tests to add (specific cases); Acceptance checks (exact commands to run); Delivery format.\n" +
    "- In Delivery format, tell the executor: do NOT commit, push, merge, or apply to the main branch — return a concise summary plus the full diff.\n" +
    "- Be concrete, minimal, and testable; keep scope narrow and list the expected changed files.\n" +
    languageRule +
    '- Output ONLY the spec as markdown — no preamble, no "Here is the spec", and do not wrap the whole reply in a code fence.\n\n' +
    taskSection +
    buildAttachmentSection(attachments)
  );
}

/**
 * Surface attached files to the drafting agent the same way the app surfaces
 * attachments to a running thread — as `@path` references, via the shared
 * segment formatter (which also shortens home paths). The drafting one-shot
 * runs read-only, so the agent reads each referenced file with its own tools
 * and multimodal models see attached images directly.
 */
function buildAttachmentSection(attachments?: readonly ExecutorSpecAttachment[]): string {
  if (!attachments || attachments.length === 0) return "";
  const refs = defaultFormatPromptSegments(
    attachments.map((attachment) => ({
      kind: "attachment" as const,
      path: attachment.path,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    })),
  ).trim();
  return (
    "The user attached these files. Read them with your read-only tools (they may be screenshots/images, video, or documents) and ground the spec in what they show:\n" +
    refs +
    "\n"
  );
}

function truncateTask(task: string): string {
  if (task.length <= MAX_TASK_CHARS) return task;
  return task.slice(0, MAX_TASK_CHARS) + "\n\n[task truncated]";
}

/**
 * Normalize a raw model reply into a usable spec: recover the final assistant
 * message if a CLI (e.g. `codex exec`) echoed its whole session transcript,
 * drop reasoning blocks, unwrap a single enclosing code fence, and cap length
 * so the result can be dropped verbatim into the experiment prompt box
 * (`MAX_EXPERIMENT_PROMPT_LENGTH`).
 */
export function cleanSpec(raw: string): string {
  // Defensive: codex one-shots normally return just the final message (see the
  // codex `runOneShot`), but if a full transcript still reaches here, keep only
  // the last assistant message before the think/fence cleanup below.
  let text = extractFinalAgentMessage(raw);
  text = text.replace(/<(think|antThinking)>[\s\S]*?<\/\1>/g, "");
  const fenced = text.trim().match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1]!;
  text = text.trim();
  if (text.length > MAX_EXPERIMENT_PROMPT_LENGTH) {
    text = text.slice(0, MAX_EXPERIMENT_PROMPT_LENGTH - 20).trimEnd() + "\n\n[spec truncated]";
  }
  return text;
}

/**
 * Draft an executor spec from a short task via a one-shot LLM call. Uses the
 * regular one-shot runner (not the text-only variant, which only Claude
 * supports) with a read-only workspace so any `supportsOneShot` agent can act
 * as the orchestrator and optionally read the repo while drafting.
 */
export async function generateExecutorSpec(
  location: ProjectLocation,
  adapter: AgentAdapter,
  task: string,
  model?: string,
  effort?: string,
  fast?: boolean,
  language?: string,
  attachments?: readonly ExecutorSpecAttachment[],
): Promise<string> {
  const effectiveModel = model ?? adapter.defaultOneShotModel;
  if (!effectiveModel) {
    throw new Error(`No default one-shot model configured for ${adapter.label}`);
  }
  if (!adapter.runOneShot && !adapter.buildOneShotCommand) {
    throw new Error(`${adapter.label} does not support one-shot generation`);
  }

  const raw = await runOneShotPromptWithFallback({
    location,
    adapter,
    model: effectiveModel,
    effort,
    fast,
    readOnlyWorkspace: true,
    timeoutMs: SPEC_GEN_TIMEOUT_MS,
    logTag: "executor-spec-gen",
    attempts: [
      {
        level: "full",
        buildPrompt: () => buildPrompt(truncateTask(task), language, attachments),
      },
    ],
  });

  const spec = cleanSpec(raw);
  if (!spec) {
    throw new Error("Executor spec generation returned empty result");
  }
  return spec;
}
