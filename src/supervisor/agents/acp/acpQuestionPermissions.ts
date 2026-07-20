import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { RuntimeEvent } from "@/shared/contracts";
import { chosenOptionIds } from "../questionAnswers";
import {
  buildQuestionAnswerEvents,
  type QuestionAnswerSourceQuestion,
} from "../questionAnswerEvents";
import type { AcpMapperState } from "./canonicalMapping/state";

interface AcpPermissionQuestion {
  id: string;
  header: string;
  question: string;
  options: Array<{ optionId: string; label: string; description?: string }>;
  multiSelect: boolean;
}

type AcpQuestionPermissionResponse = RequestPermissionResponse & {
  answers?: Record<string, string>;
};

/**
 * Qwen Code carries AskUserQuestion through ACP's requestPermission method.
 * The extension is deliberately detected from its semantic payload rather
 * than the provider kind: a non-empty `rawInput.questions` array is the same
 * signal Qwen's own ACP clients use.
 */
export function parseAcpPermissionQuestions(
  request: RequestPermissionRequest,
): AcpPermissionQuestion[] {
  const rawInput = request.toolCall?.rawInput;
  if (!isRecord(rawInput) || !Array.isArray(rawInput.questions)) return [];

  return rawInput.questions.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.question !== "string" || entry.question.length === 0) {
      return [];
    }
    const id = String(index);
    const header =
      typeof entry.header === "string" && entry.header.length > 0 ? entry.header : entry.question;
    const options = Array.isArray(entry.options)
      ? entry.options.flatMap((option, optionIndex) => {
          if (!isRecord(option)) return [];
          const fallback = `Option ${optionIndex + 1}`;
          const label =
            typeof option.label === "string" && option.label.length > 0
              ? option.label
              : typeof option.optionId === "string" && option.optionId.length > 0
                ? option.optionId
                : fallback;
          const optionId =
            typeof option.optionId === "string" && option.optionId.length > 0
              ? option.optionId
              : label;
          return [
            {
              optionId,
              label,
              ...(typeof option.description === "string" && option.description.length > 0
                ? { description: option.description }
                : {}),
            },
          ];
        })
      : [];
    return [
      {
        id,
        header,
        question: entry.question,
        options,
        multiSelect: entry.multiSelect === true,
      },
    ];
  });
}

export function mapAcpQuestionPermissionRequest(
  request: RequestPermissionRequest,
  state: AcpMapperState,
  requestId: string,
): RuntimeEvent | undefined {
  const questions = parseAcpPermissionQuestions(request);
  const firstQuestion = questions[0];
  if (!firstQuestion) return undefined;

  return {
    type: "request.opened",
    threadId: state.threadId,
    requestId,
    requestType: "tool_user_input",
    payload: {
      summary: firstQuestion.question,
      details: {
        userInputForm: {
          questions: questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            options: question.options,
            multiSelect: question.multiSelect,
          })),
        },
      },
      ...(questions.length === 1 ? { options: firstQuestion.options } : {}),
      ...(questions.length === 1 ? { multiSelect: firstQuestion.multiSelect } : {}),
    },
  };
}

export function normalizeAcpQuestionPermissionResponse(
  request: RequestPermissionRequest,
  response: unknown,
): AcpQuestionPermissionResponse {
  if (isCancelledResponse(response)) return { outcome: { outcome: "cancelled" } };

  const optionId = selectedPermissionOptionId(request, response);
  if (!optionId) return { outcome: { outcome: "cancelled" } };
  const answers = normalizeQuestionAnswers(request, response);
  return {
    outcome: { outcome: "selected", optionId },
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
  };
}

export function buildAcpQuestionPermissionAnswerEvents(input: {
  threadId: string;
  itemId: string;
  request: RequestPermissionRequest;
  response: unknown;
}): RuntimeEvent[] {
  if (isCancelledResponse(input.response)) return [];
  const questions = parseAcpPermissionQuestions(input.request);
  return buildQuestionAnswerEvents({
    threadId: input.threadId,
    itemId: input.itemId,
    questions: questions.map(
      (question): QuestionAnswerSourceQuestion => ({
        keys: [question.id, question.question, question.header],
        header: question.header,
        question: question.question,
        options: question.options,
      }),
    ),
    answers: responseAnswers(input.response),
  });
}

/** Suppress the redundant tool row once the same call is presented as a form. */
export function isAcpAskUserQuestionToolCall(toolCall: {
  title?: unknown;
  rawInput?: unknown;
  _meta?: unknown;
}): boolean {
  if (!isRecord(toolCall.rawInput) || !Array.isArray(toolCall.rawInput.questions)) return false;
  const metaName = isRecord(toolCall._meta) ? toolCall._meta.toolName : undefined;
  const candidates = [metaName, toolCall.title];
  return candidates.some(
    (candidate) =>
      typeof candidate === "string" &&
      /^(?:ask[_ ]?user[_ ]?question|ask user \d+ questions?)(?::|\b)/iu.test(candidate.trim()),
  );
}

function normalizeQuestionAnswers(
  request: RequestPermissionRequest,
  response: unknown,
): Record<string, string> {
  const rawAnswers = responseAnswers(response);
  const answers: Record<string, string> = {};
  for (const question of parseAcpPermissionQuestions(request)) {
    const raw =
      rawAnswers[question.id] ?? rawAnswers[question.question] ?? rawAnswers[question.header];
    const selected = chosenOptionIds(raw);
    if (selected.length === 0) continue;
    answers[question.id] = selected
      .map(
        (optionId) =>
          question.options.find((option) => option.optionId === optionId)?.label ?? optionId,
      )
      .join(", ");
  }
  return answers;
}

function responseAnswers(response: unknown): Record<string, unknown> {
  if (!isRecord(response) || !isRecord(response.answers)) return {};
  return response.answers;
}

function selectedPermissionOptionId(
  request: RequestPermissionRequest,
  response: unknown,
): string | undefined {
  const requested =
    isRecord(response) && typeof response.optionId === "string" ? response.optionId : undefined;
  if (requested && request.options.some((option) => option.optionId === requested))
    return requested;
  return (
    request.options.find((option) => option.kind === "allow_once") ??
    request.options.find((option) => !option.kind.startsWith("reject"))
  )?.optionId;
}

const REJECTION_OPTION_ID_PATTERN = /(?:cancel|decline|deny|reject|abort)/iu;

/** True when an ACP option id names a decline/cancel/reject/abort choice. */
export function isRejectionOptionId(optionId: unknown): boolean {
  return typeof optionId === "string" && REJECTION_OPTION_ID_PATTERN.test(optionId);
}

function isCancelledResponse(response: unknown): boolean {
  if (!isRecord(response)) return true;
  if (response.action === "cancel" || response.action === "decline") return true;
  return isRejectionOptionId(response.optionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
