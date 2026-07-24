import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptSegment, Thread } from "@/shared/contracts";

const mocks = vi.hoisted(() => ({
  submitConsultation: vi.fn<(input: { projectId: string; parentThreadId: string; campaignGroupId: string; message: string }) => Promise<unknown>>(),
  submitThreadInput: vi.fn<(threadId: string, prompt: string, segments?: PromptSegment[]) => Promise<void>>(),
  changeThreadConfig: vi.fn<(...args: unknown[]) => void>(),
  resolveThreadServerRequest: vi.fn<(...args: unknown[]) => Promise<void>>(),
  toastWarning: vi.fn<(message: string) => void>(),
  toastDanger: vi.fn<(message: string) => void>(),
  friendlyError: vi.fn<(error: unknown) => string>(() => "Safe consultation error"),
  requestChatScrollToBottom: vi.fn<(threadId: string) => void>(),
  saveThreadDraftContent: vi.fn<(...args: unknown[]) => void>(),
  projects: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/renderer/actions/consultationActions", () => ({
  submitConsultation: mocks.submitConsultation,
}));

vi.mock("@/renderer/actions/threadRuntimeActions", () => ({
  submitThreadInput: mocks.submitThreadInput,
  changeThreadConfig: mocks.changeThreadConfig,
  resolveThreadServerRequest: mocks.resolveThreadServerRequest,
}));

vi.mock("@heroui/react", () => ({
  toast: {
    warning: mocks.toastWarning,
    danger: mocks.toastDanger,
  },
}));

vi.mock("@/shared/messages", () => ({
  friendlyError: mocks.friendlyError,
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: {
    getState: () => ({
      projects: mocks.projects,
      requestChatScrollToBottom: mocks.requestChatScrollToBottom,
      saveThreadDraftContent: mocks.saveThreadDraftContent,
    }),
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    setPendingSteer: vi.fn<(...args: unknown[]) => Promise<void>>(),
  }),
}));

vi.mock("@/renderer/state/runtimeRequestActions", () => ({
  applyOptimisticRequestResolution: vi.fn<(...args: unknown[]) => () => void>(() => vi.fn<() => void>()),
}));

vi.mock("@/renderer/state/browserAttachInbox", () => ({
  buildLcSelectorFence: vi.fn<(...args: unknown[]) => string>(() => ""),
  buildSelectorPlainText: vi.fn<(...args: unknown[]) => string>(() => ""),
}));

import { submitComposerPrompt, type ComposerSubmitContext } from "./threadComposerSubmit";

const CONSULTATION_SEGMENTS: PromptSegment[] = [
  { kind: "text", content: "@codex verify these figures" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeThread(id: string): Thread {
  return {
    id,
    projectId: "campaign-project",
    title: `Thread ${id}`,
    agentKind: "claude",
    config: { model: "sonnet" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
  };
}

function makeContext(threadId = "thread-1") {
  const clear = vi.fn<() => void>();
  const focus = vi.fn<() => void>();
  const restoreFromSegments = vi.fn<(segments: PromptSegment[]) => void>();
  const setPrompt = vi.fn<(value: string) => void>();
  const setHasContent = vi.fn<(value: boolean) => void>();
  const setIsSubmitting = vi.fn<(value: boolean) => void>();
  const normalSubmit = vi.fn<(prompt: string, segments?: PromptSegment[]) => Promise<void>>().mockResolvedValue(undefined);
  const attachments = {
    attachments: [],
    toSegments: vi.fn<() => PromptSegment[]>(() => []),
    clearAll: vi.fn<() => void>(),
    restore: vi.fn<(attachments: unknown[]) => void>(),
  };
  const ctx: ComposerSubmitContext = {
    thread: makeThread(threadId),
    agentStatus: undefined,
    presentationMode: "gui",
    usesTerminalPresentation: false,
    canSubmit: true,
    usesPendingSteerPath: false,
    needsFocusBeforeInput: false,
    activeRuntimeRequest: undefined,
    approvalDenyOption: undefined,
    availableCommands: [],
    attachments: attachments as unknown as ComposerSubmitContext["attachments"],
    mentionRef: {
      current: { clear, focus, restoreFromSegments } as unknown as NonNullable<
        ComposerSubmitContext["mentionRef"]["current"]
      >,
    },
    terminalPaneRef: { current: null },
    latestSegmentsRef: { current: CONSULTATION_SEGMENTS },
    submittedRef: { current: false },
    isCurrentSession: () => true,
    setPrompt,
    setHasContent,
    setIsSubmitting,
    requestOpenControl: vi.fn<(target: "model" | "effort") => void>(),
    onSubmitInput: normalSubmit,
  };
  return {
    ctx,
    clear,
    focus,
    restoreFromSegments,
    setPrompt,
    setHasContent,
    normalSubmit,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projects.splice(0, mocks.projects.length, {
    id: "campaign-project",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "cg-1",
      clientName: "AIB NI",
      campaignName: "Community Fund 2026",
    },
  });
});

describe("submitComposerPrompt consultation routing", () => {
  it("clears the correct composer once only after durable submission succeeds", async () => {
    mocks.submitConsultation.mockResolvedValue({
      ok: true,
      consultation: { id: "consultation-1" },
    });
    const { ctx, setPrompt, setHasContent, clear, focus, normalSubmit } = makeContext();

    submitComposerPrompt(CONSULTATION_SEGMENTS, ctx);
    expect(setPrompt).not.toHaveBeenCalled();
    await settle();

    expect(mocks.submitConsultation).toHaveBeenCalledTimes(1);
    expect(mocks.submitConsultation).toHaveBeenCalledWith({
      projectId: "campaign-project",
      parentThreadId: "thread-1",
      campaignGroupId: "cg-1",
      message: "@codex verify these figures",
    });
    expect(setPrompt).toHaveBeenCalledTimes(1);
    expect(setPrompt).toHaveBeenCalledWith("");
    expect(setHasContent).toHaveBeenCalledWith(false);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(normalSubmit).not.toHaveBeenCalled();
    expect(mocks.submitThreadInput).not.toHaveBeenCalled();
  });

  it("preserves the message on a structured rejection", async () => {
    mocks.submitConsultation.mockResolvedValue({
      ok: false,
      code: "invalid_request",
      message: "Campaign context is unavailable.",
    });
    const { ctx, setPrompt, clear, normalSubmit } = makeContext();

    submitComposerPrompt(CONSULTATION_SEGMENTS, ctx);
    await settle();

    expect(setPrompt).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(mocks.toastWarning).toHaveBeenCalledWith("Campaign context is unavailable.");
    expect(normalSubmit).not.toHaveBeenCalled();
  });

  it("catches an IPC rejection, preserves the message and shows a safe error", async () => {
    const internalError = new Error("token=secret /private/internal/path");
    mocks.submitConsultation.mockRejectedValue(internalError);
    const { ctx, setPrompt, clear, normalSubmit } = makeContext();

    submitComposerPrompt(CONSULTATION_SEGMENTS, ctx);
    await settle();

    expect(setPrompt).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(mocks.friendlyError).toHaveBeenCalledWith(internalError);
    expect(mocks.toastWarning).toHaveBeenCalledWith("Safe consultation error");
    expect(mocks.toastWarning).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
    expect(normalSubmit).not.toHaveBeenCalled();
  });

  it("blocks a duplicate submission in the same thread while the first is pending", async () => {
    const pending = deferred<{ ok: true; consultation: { id: string } }>();
    mocks.submitConsultation.mockReturnValue(pending.promise);
    const first = makeContext("thread-1");
    const second = makeContext("thread-1");

    submitComposerPrompt(CONSULTATION_SEGMENTS, first.ctx);
    submitComposerPrompt(CONSULTATION_SEGMENTS, second.ctx);
    expect(mocks.submitConsultation).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true, consultation: { id: "consultation-1" } });
    await settle();
    expect(first.setPrompt).toHaveBeenCalledWith("");
    expect(second.setPrompt).not.toHaveBeenCalled();
  });

  it("allows simultaneous consultations in different threads", async () => {
    const firstPending = deferred<{ ok: true; consultation: { id: string } }>();
    const secondPending = deferred<{ ok: true; consultation: { id: string } }>();
    mocks.submitConsultation
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);
    const first = makeContext("thread-1");
    const second = makeContext("thread-2");

    submitComposerPrompt(CONSULTATION_SEGMENTS, first.ctx);
    submitComposerPrompt(CONSULTATION_SEGMENTS, second.ctx);
    expect(mocks.submitConsultation).toHaveBeenCalledTimes(2);
    expect(mocks.submitConsultation.mock.calls.map(([input]) => input.parentThreadId)).toEqual([
      "thread-1",
      "thread-2",
    ]);

    firstPending.resolve({ ok: true, consultation: { id: "consultation-1" } });
    secondPending.resolve({ ok: true, consultation: { id: "consultation-2" } });
    await settle();
    expect(first.setPrompt).toHaveBeenCalledWith("");
    expect(second.setPrompt).toHaveBeenCalledWith("");
  });
});
