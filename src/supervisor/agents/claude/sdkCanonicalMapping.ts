import { randomUUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanonicalContentBlock,
  CanonicalItemType,
  CanonicalRequestType,
  PromptSegment,
  RuntimeEvent,
  TurnState,
} from "@/shared/contracts";

interface TextItemState {
  itemId: string;
  emittedText: boolean;
  fallbackText: string;
  completed: boolean;
}

interface ToolItemState {
  itemId: string;
  itemType: CanonicalItemType;
  toolName: string;
  input: Record<string, unknown>;
  partialInputJson: string;
  lastInputFingerprint?: string;
}

export interface ClaudeMapperState {
  threadId: string;
  currentTurnId?: string;
  assistantTextItems: Map<number, TextItemState>;
  reasoningItems: Map<number, TextItemState>;
  toolItemsByIndex: Map<number, ToolItemState>;
  toolItemsById: Map<string, ToolItemState>;
}

export function createClaudeMapperState(threadId: string): ClaudeMapperState {
  return {
    threadId,
    assistantTextItems: new Map(),
    reasoningItems: new Map(),
    toolItemsByIndex: new Map(),
    toolItemsById: new Map(),
  };
}

function newItemId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function buildPromptContentBlocks(
  prompt: string,
  segments?: PromptSegment[],
): CanonicalContentBlock[] {
  if (!segments || segments.length === 0) {
    return prompt.length > 0 ? [{ kind: "text", text: prompt }] : [];
  }

  const blocks: CanonicalContentBlock[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.content.length > 0) blocks.push({ kind: "text", text: segment.content });
      continue;
    }
    blocks.push({
      kind: "file",
      path: segment.path,
      name: segment.path.split(/[\\/]/).pop(),
      source: segment.kind === "attachment" ? "attachment" : "mention",
    });
  }
  return blocks;
}

export function startClaudeTurn(
  state: ClaudeMapperState,
  turnId: string,
  prompt: string,
  segments: PromptSegment[] | undefined,
  userMessageItemId?: string,
): RuntimeEvent[] {
  state.currentTurnId = turnId;
  state.assistantTextItems.clear();
  state.reasoningItems.clear();
  state.toolItemsByIndex.clear();
  state.toolItemsById.clear();

  const userItemId = userMessageItemId ?? newItemId("user");
  return [
    { type: "turn.started", threadId: state.threadId, turnId },
    {
      type: "item.started",
      threadId: state.threadId,
      itemId: userItemId,
      itemType: "user_message",
      payload: { content: buildPromptContentBlocks(prompt, segments) },
    },
    { type: "item.completed", threadId: state.threadId, itemId: userItemId },
  ];
}

function ensureTextItem(
  state: ClaudeMapperState,
  map: Map<number, TextItemState>,
  index: number,
  itemType: "assistant_message" | "reasoning",
  events: RuntimeEvent[],
): TextItemState {
  const existing = map.get(index);
  if (existing && !existing.completed) return existing;
  const item: TextItemState = {
    itemId: newItemId(itemType === "assistant_message" ? "asst" : "reason"),
    emittedText: false,
    fallbackText: "",
    completed: false,
  };
  map.set(index, item);
  events.push({ type: "item.started", threadId: state.threadId, itemId: item.itemId, itemType });
  return item;
}

function completeTextItem(
  state: ClaudeMapperState,
  item: TextItemState,
  stream: "assistant_text" | "reasoning_text",
  events: RuntimeEvent[],
): void {
  if (item.completed) return;
  if (!item.emittedText && item.fallbackText.length > 0) {
    events.push({
      type: "content.delta",
      threadId: state.threadId,
      itemId: item.itemId,
      stream,
      delta: item.fallbackText,
    });
  }
  item.completed = true;
  events.push({ type: "item.completed", threadId: state.threadId, itemId: item.itemId });
}

export function closeClaudeOpenItems(state: ClaudeMapperState): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (const item of state.assistantTextItems.values()) {
    completeTextItem(state, item, "assistant_text", events);
  }
  for (const item of state.reasoningItems.values()) {
    completeTextItem(state, item, "reasoning_text", events);
  }
  for (const tool of state.toolItemsByIndex.values()) {
    events.push({
      type: "item.completed",
      threadId: state.threadId,
      itemId: tool.itemId,
      payload: toolPayload(tool, "success"),
    });
  }
  state.assistantTextItems.clear();
  state.reasoningItems.clear();
  state.toolItemsByIndex.clear();
  state.toolItemsById.clear();
  return events;
}

function classifyToolItemType(toolName: string): CanonicalItemType {
  const name = toolName.toLowerCase();
  if (name === "todowrite" || name.includes("todo")) return "plan";
  if (/(^|[_-])(bash|shell|command)($|[_-])/.test(name)) return "command_execution";
  if (/(^|[_-])(edit|write|patch|multiedit|notebookedit)($|[_-])/.test(name)) {
    return "file_change";
  }
  if (name.includes("websearch") || name.includes("webfetch") || name.includes("search")) {
    return "web_search";
  }
  return "tool_call";
}

function classifyRequestType(toolName: string): CanonicalRequestType {
  const itemType = classifyToolItemType(toolName);
  if (itemType === "command_execution") return "command_execution_approval";
  if (itemType === "file_change") return "file_change_approval";
  return "tool_user_input";
}

export function mapClaudePermissionRequest(input: {
  threadId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  title?: string;
  description?: string;
}): RuntimeEvent {
  const summary = input.title ?? summarizeToolRequest(input.toolName, input.toolInput);
  return {
    type: "request.opened",
    threadId: input.threadId,
    requestId: input.requestId,
    requestType: classifyRequestType(input.toolName),
    payload: {
      summary,
      details: {
        toolName: input.toolName,
        input: input.toolInput,
        ...(input.description ? { description: input.description } : {}),
      },
      options: [
        { optionId: "accept", label: "Allow" },
        { optionId: "acceptForSession", label: "Always Allow" },
        { optionId: "decline", label: "Deny" },
      ],
    },
  };
}

export function mapClaudeQuestionRequest(input: {
  threadId: string;
  requestId: string;
  questions: ClaudeQuestion[];
}): RuntimeEvent {
  const firstQuestion = input.questions[0];
  return {
    type: "request.opened",
    threadId: input.threadId,
    requestId: input.requestId,
    requestType: "tool_user_input",
    payload: {
      summary: firstQuestion?.question ?? "Claude needs more information",
      details: { questions: input.questions },
      options: input.questions.length === 1 ? firstQuestion?.options : undefined,
      multiSelect: input.questions.length === 1 ? firstQuestion?.multiSelect : undefined,
    },
  };
}

export interface ClaudeQuestion {
  question: string;
  header: string;
  options: Array<{ optionId: string; label: string; description?: string }>;
  multiSelect?: boolean;
}

export function parseClaudeQuestions(input: Record<string, unknown>): ClaudeQuestion[] {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  return rawQuestions.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const q = raw as Record<string, unknown>;
    const question =
      typeof q.question === "string" && q.question.length > 0
        ? q.question
        : `Question ${index + 1}`;
    const header =
      typeof q.header === "string" && q.header.length > 0 ? q.header : `Question ${index + 1}`;
    const options = Array.isArray(q.options)
      ? q.options.flatMap((opt, optIndex) => {
          if (!opt || typeof opt !== "object") return [];
          const o = opt as Record<string, unknown>;
          const label = typeof o.label === "string" ? o.label : `Option ${optIndex + 1}`;
          return [
            {
              optionId: label,
              label,
              ...(typeof o.description === "string" ? { description: o.description } : {}),
            },
          ];
        })
      : [];
    return [{ question, header, options, multiSelect: q.multiSelect === true }];
  });
}

function toolPayload(
  tool: ToolItemState,
  status: "running" | "success" | "error",
  result?: unknown,
): unknown {
  if (tool.itemType === "command_execution") {
    return {
      command:
        typeof tool.input.command === "string"
          ? tool.input.command
          : summarizeToolRequest(tool.toolName, tool.input),
    };
  }
  if (tool.itemType === "file_change") {
    const path =
      typeof tool.input.file_path === "string"
        ? tool.input.file_path
        : typeof tool.input.path === "string"
          ? tool.input.path
          : "";
    return { path, changeKind: inferFileChangeKind(tool.toolName) };
  }
  if (tool.itemType === "web_search") {
    const query =
      typeof tool.input.query === "string"
        ? tool.input.query
        : summarizeToolRequest(tool.toolName, tool.input);
    return { query };
  }
  if (tool.itemType === "plan") {
    return { steps: extractPlanSteps(tool.input) };
  }
  return { name: tool.toolName, args: tool.input, result, status };
}

function inferFileChangeKind(toolName: string): "create" | "edit" | "delete" {
  const n = toolName.toLowerCase();
  if (n.includes("write")) return "create";
  if (n.includes("delete") || n.includes("remove")) return "delete";
  return "edit";
}

function extractPlanSteps(
  input: Record<string, unknown>,
): Array<{ step: string; status: "pending" | "in_progress" | "completed" }> {
  const todos = input.todos;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo) => {
    if (!todo || typeof todo !== "object") return [];
    const obj = todo as Record<string, unknown>;
    const step =
      typeof obj.content === "string" && obj.content.trim() ? obj.content.trim() : "Task";
    const status =
      obj.status === "completed"
        ? "completed"
        : obj.status === "in_progress"
          ? "in_progress"
          : "pending";
    return [{ step, status }];
  });
}

function summarizeToolRequest(toolName: string, input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : undefined;
  if (command) return `${toolName}: ${command}`;
  const path =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : undefined;
  if (path) return `${toolName}: ${path}`;
  try {
    const serialized = JSON.stringify(input);
    return serialized.length > 300
      ? `${toolName}: ${serialized.slice(0, 297)}...`
      : `${toolName}: ${serialized}`;
  } catch {
    return toolName;
  }
}

function inputFingerprint(value: Record<string, unknown>): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function tryParseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).join("");
  if (!value || typeof value !== "object") return "";
  const obj = value as { text?: unknown; content?: unknown };
  if (typeof obj.text === "string") return obj.text;
  return extractText(obj.content);
}

function mapResultState(message: Extract<SDKMessage, { type: "result" }>): TurnState {
  if (message.subtype === "success") return "completed";
  const errors =
    "errors" in message && Array.isArray(message.errors)
      ? message.errors.join(" ").toLowerCase()
      : "";
  if (errors.includes("abort") || errors.includes("interrupt")) return "interrupted";
  if (errors.includes("cancel")) return "cancelled";
  return "failed";
}

export function mapClaudeSdkMessage(message: SDKMessage, state: ClaudeMapperState): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  if (message.type === "stream_event") {
    const event = message.event as unknown as Record<string, unknown>;
    const type = event.type;
    const index = typeof event.index === "number" ? event.index : 0;

    if (type === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "text") {
        const item = ensureTextItem(
          state,
          state.assistantTextItems,
          index,
          "assistant_message",
          events,
        );
        const text = typeof block.text === "string" ? block.text : "";
        if (text.length > 0) item.fallbackText = text;
        return events;
      }
      if (block?.type === "thinking") {
        ensureTextItem(state, state.reasoningItems, index, "reasoning", events);
        return events;
      }
      if (
        block?.type === "tool_use" ||
        block?.type === "server_tool_use" ||
        block?.type === "mcp_tool_use"
      ) {
        const toolName = typeof block.name === "string" ? block.name : "Tool";
        const itemType = classifyToolItemType(toolName);
        const input =
          block.input && typeof block.input === "object" && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {};
        const itemId = typeof block.id === "string" ? block.id : newItemId("tool");
        const tool: ToolItemState = {
          itemId,
          itemType,
          toolName,
          input,
          partialInputJson: "",
          ...(() => {
            const fingerprint = Object.keys(input).length > 0 ? inputFingerprint(input) : undefined;
            return fingerprint ? { lastInputFingerprint: fingerprint } : {};
          })(),
        };
        state.toolItemsByIndex.set(index, tool);
        state.toolItemsById.set(itemId, tool);
        events.push({
          type: "item.started",
          threadId: state.threadId,
          itemId,
          itemType,
          payload: toolPayload(tool, "running"),
        });
        return events;
      }
      return events;
    }

    if (type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        const text = typeof delta.text === "string" ? delta.text : "";
        if (!text) return events;
        const item = ensureTextItem(
          state,
          state.assistantTextItems,
          index,
          "assistant_message",
          events,
        );
        item.emittedText = true;
        events.push({
          type: "content.delta",
          threadId: state.threadId,
          itemId: item.itemId,
          stream: "assistant_text",
          delta: text,
        });
        return events;
      }
      if (delta?.type === "thinking_delta") {
        const text = typeof delta.thinking === "string" ? delta.thinking : "";
        if (!text) return events;
        const item = ensureTextItem(state, state.reasoningItems, index, "reasoning", events);
        item.emittedText = true;
        events.push({
          type: "content.delta",
          threadId: state.threadId,
          itemId: item.itemId,
          stream: "reasoning_text",
          delta: text,
        });
        return events;
      }
      if (delta?.type === "input_json_delta") {
        const tool = state.toolItemsByIndex.get(index);
        const partial = typeof delta.partial_json === "string" ? delta.partial_json : "";
        if (!tool || !partial) return events;
        tool.partialInputJson += partial;
        const parsed = tryParseJsonRecord(tool.partialInputJson);
        if (!parsed) return events;
        const fingerprint = inputFingerprint(parsed);
        if (!fingerprint || fingerprint === tool.lastInputFingerprint) return events;
        tool.input = parsed;
        tool.lastInputFingerprint = fingerprint;
        events.push({
          type: "item.updated",
          threadId: state.threadId,
          itemId: tool.itemId,
          payload: toolPayload(tool, "running"),
        });
        return events;
      }
      return events;
    }

    if (type === "content_block_stop") {
      const assistant = state.assistantTextItems.get(index);
      if (assistant) completeTextItem(state, assistant, "assistant_text", events);
      const reasoning = state.reasoningItems.get(index);
      if (reasoning) completeTextItem(state, reasoning, "reasoning_text", events);
      return events;
    }
  }

  if (message.type === "assistant") {
    const content = (message.message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
        const block = content[blockIndex];
        if (!block || typeof block !== "object") continue;
        const obj = block as { type?: unknown; text?: unknown };
        if (obj.type !== "text" || typeof obj.text !== "string" || obj.text.length === 0) continue;
        const existing = state.assistantTextItems.get(blockIndex);
        if (existing?.completed) continue;
        const item = ensureTextItem(
          state,
          state.assistantTextItems,
          blockIndex,
          "assistant_message",
          events,
        );
        if (!item.emittedText) item.fallbackText = obj.text;
        completeTextItem(state, item, "assistant_text", events);
      }
    }
    return events;
  }

  if (message.type === "user") {
    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) return events;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const obj = block as Record<string, unknown>;
      if (obj.type !== "tool_result") continue;
      const toolUseId = typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined;
      if (!toolUseId) continue;
      const tool = state.toolItemsById.get(toolUseId);
      if (!tool) continue;
      const isError = obj.is_error === true;
      const text = extractText(obj.content);
      const stream =
        tool.itemType === "command_execution"
          ? "command_output"
          : tool.itemType === "file_change"
            ? "file_change_output"
            : undefined;
      if (stream && text.length > 0) {
        events.push({
          type: "content.delta",
          threadId: state.threadId,
          itemId: tool.itemId,
          stream,
          delta: text,
        });
      }
      events.push({
        type: "item.updated",
        threadId: state.threadId,
        itemId: tool.itemId,
        payload:
          tool.itemType === "tool_call"
            ? toolPayload(tool, isError ? "error" : "success", obj)
            : toolPayload(tool, isError ? "error" : "success"),
      });
      events.push({ type: "item.completed", threadId: state.threadId, itemId: tool.itemId });
      state.toolItemsById.delete(toolUseId);
      for (const [idx, value] of state.toolItemsByIndex) {
        if (value.itemId === toolUseId) state.toolItemsByIndex.delete(idx);
      }
    }
    return events;
  }

  if (message.type === "result") {
    const stateValue = mapResultState(message);
    events.push(...closeClaudeOpenItems(state));
    if (stateValue === "failed") {
      const msg =
        "errors" in message && Array.isArray(message.errors) && message.errors[0]
          ? String(message.errors[0])
          : "Claude turn failed.";
      events.push({ type: "error", threadId: state.threadId, message: msg });
    }
    if (state.currentTurnId) {
      events.push({
        type: "turn.completed",
        threadId: state.threadId,
        turnId: state.currentTurnId,
        state: stateValue,
      });
      delete state.currentTurnId;
    }
    return events;
  }

  if (message.type === "system" && message.subtype === "local_command_output") {
    const itemId = newItemId("asst");
    events.push({
      type: "item.started",
      threadId: state.threadId,
      itemId,
      itemType: "assistant_message",
    });
    events.push({
      type: "content.delta",
      threadId: state.threadId,
      itemId,
      stream: "assistant_text",
      delta: message.content,
    });
    events.push({ type: "item.completed", threadId: state.threadId, itemId });
  }

  return events;
}
