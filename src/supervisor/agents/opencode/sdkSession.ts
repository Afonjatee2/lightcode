/**
 * OpenCode SDK structured session.
 *
 * One class powers two flows:
 *  - **Terminal mode** (default): the runtime calls `activate` → `openThread`
 *    to allocate a session id from the live `opencode serve` instance, then
 *    immediately disposes (`liveInputMode === "terminal"`). The TUI launches
 *    with `--session <id>` and resumes from SQLite — same observable
 *    behaviour as the previous `opencode acp` ephemeral allocation, but over
 *    HTTP+SDK so we share infrastructure with the GUI flow.
 *  - **GUI mode**: same `activate`/`openThread` but the session stays alive
 *    for the thread's lifetime. SSE subscription routes OpenCode events
 *    through `sdkCanonicalMapping` → renderer chat items. `startTurn` calls
 *    `session.promptAsync`; `interruptTurn` calls `session.abort`.
 */

import { pathToFileURL } from "node:url";
import type { Event } from "@opencode-ai/sdk/v2";
import type {
  ProjectLocation,
  PromptSegment,
  RuntimeEvent,
  SessionRef,
  ThreadAttention,
  ThreadConfig,
  ThreadServerRequestId,
  ThreadStatus,
} from "@/shared/contracts";
import {
  createKnownSessionRef,
  type AgentLaunchOptions,
  type CreateStructuredSessionInput,
  type StartTurnOptions,
  type StructuredSessionHandle,
  type StructuredSessionListener,
} from "../base";
import { buildOpenCodePermissionRules } from "./permissionRules";
import { acquireOpenCodeServer, type AcquiredOpenCodeServer } from "./sdkClient";
import {
  closeOpenItems,
  createOpenCodeMapperState,
  mapOpenCodeEvent,
  type OpenCodeMapperState,
} from "./sdkCanonicalMapping";

interface PendingPermission {
  kind: "permission";
  requestID: string;
}

interface PendingQuestion {
  kind: "question";
  requestID: string;
}

type PendingRequest = PendingPermission | PendingQuestion;

function resolveAbsolutePath(location: ProjectLocation, segmentPath: string): string {
  if (location.kind === "wsl") {
    // Segments arrive as host (Windows) UNC paths or already-Linux paths.
    // OpenCode runs inside the distro, so we must hand it a Linux path.
    if (/^\/\//.test(segmentPath) || /^\\\\/.test(segmentPath)) {
      // UNC share like \\wsl$\Ubuntu\home\... → strip the prefix.
      const unc = segmentPath.replace(/\\/g, "/");
      const m = unc.match(/^\/\/wsl(?:\$|\.localhost)\/[^/]+(\/.*)$/i);
      if (m && m[1]) return m[1];
    }
    return segmentPath;
  }
  return segmentPath;
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function segmentsToParts(
  prompt: string,
  segments: PromptSegment[] | undefined,
  location: ProjectLocation,
): Array<
  { type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }
> {
  const parts: Array<
    { type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }
  > = [];

  if (segments && segments.length > 0) {
    for (const seg of segments) {
      if (seg.kind === "text") {
        if (seg.content.length > 0) parts.push({ type: "text", text: seg.content });
        continue;
      }
      const absolute = resolveAbsolutePath(location, seg.path);
      const url = pathToFileURL(absolute).href;
      const mime =
        seg.kind === "attachment" && seg.mimeType ? seg.mimeType : inferMimeFromPath(absolute);
      const filename = absolute.split(/[\\/]/).pop();
      parts.push({
        type: "file",
        mime,
        ...(filename ? { filename } : {}),
        url,
      });
    }
  } else if (prompt.trim().length > 0) {
    parts.push({ type: "text", text: prompt });
  }

  return parts;
}

function parseModelSlug(
  modelSlug: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!modelSlug) return undefined;
  const slash = modelSlug.indexOf("/");
  if (slash <= 0) return undefined;
  return {
    providerID: modelSlug.slice(0, slash),
    modelID: modelSlug.slice(slash + 1),
  };
}

function mapStatusUpdate(properties: { sessionID: string; status: { type: string } }): {
  status: ThreadStatus;
  attention: ThreadAttention;
} {
  switch (properties.status.type) {
    case "busy":
      return { status: "working", attention: "working" };
    case "idle":
      return { status: "idle", attention: "none" };
    case "retry":
      return { status: "working", attention: "working" };
    default:
      return { status: "idle", attention: "none" };
  }
}

export class OpencodeSdkSession implements StructuredSessionHandle {
  launchOptions: AgentLaunchOptions;

  private readonly input: CreateStructuredSessionInput;
  private readonly threadId: string;
  private readonly isGui: boolean;
  private listener: StructuredSessionListener | undefined;
  private acquired: AcquiredOpenCodeServer | undefined;
  private sessionId: string | undefined;
  private sseAbort: AbortController | undefined;
  private mapperState: OpenCodeMapperState | undefined;
  private bufferedRuntimeEvents: RuntimeEvent[] = [];
  private currentConfig: ThreadConfig | undefined;
  private activated = false;
  private disposed = false;
  private pendingRequests = new Map<ThreadServerRequestId, PendingRequest>();

  private constructor(input: CreateStructuredSessionInput) {
    this.input = input;
    this.threadId = input.threadId;
    this.isGui = input.presentationMode === "gui";
    this.currentConfig = input.config;
    this.launchOptions = { suppressResumeConfigOverrides: true };
  }

  static create(input: CreateStructuredSessionInput): Promise<OpencodeSdkSession> {
    return Promise.resolve(new OpencodeSdkSession(input));
  }

  setListener(listener: StructuredSessionListener): void {
    this.listener = listener;
    if (this.bufferedRuntimeEvents.length > 0 && listener.onRuntimeEvent) {
      const drain = this.bufferedRuntimeEvents;
      this.bufferedRuntimeEvents = [];
      for (const ev of drain) listener.onRuntimeEvent(ev);
    }
    if (this.sessionId) {
      listener.onUpdate({
        status: "idle",
        attention: "none",
        sessionRef: createKnownSessionRef(this.sessionId),
      });
    }
  }

  async activate(): Promise<void> {
    if (this.activated) {
      throw new Error("OpencodeSdkSession already activated.");
    }
    if (this.disposed) {
      throw new Error("OpencodeSdkSession was disposed before activation.");
    }
    this.activated = true;

    this.acquired = await acquireOpenCodeServer({
      projectLocation: this.input.projectLocation,
    });

    if (this.isGui) {
      this.mapperState = createOpenCodeMapperState(this.threadId);
      this.startEventStream();
    }
  }

  async openThread(config: ThreadConfig, sessionRef?: SessionRef): Promise<string> {
    const acquired = this.requireAcquired();
    this.currentConfig = config;

    if (sessionRef?.providerSessionId) {
      // Resume existing session.
      const existing = await acquired.client.session.get({
        sessionID: sessionRef.providerSessionId,
      });
      const id = existing.data?.id;
      if (!id) throw new Error("opencode session.get returned no id");
      this.sessionId = id;
      return id;
    }

    const created = await acquired.client.session.create({
      title: `lightcode/${this.threadId.slice(0, 8)}`,
      permission: buildOpenCodePermissionRules(config.approvalPolicy),
    });
    const id = created.data?.id;
    if (!id) throw new Error("opencode session.create returned no id");
    this.sessionId = id;
    return id;
  }

  async startTurn(
    prompt: string,
    config: ThreadConfig,
    segments?: PromptSegment[],
    options?: StartTurnOptions,
  ): Promise<void> {
    const acquired = this.requireAcquired();
    const sessionID = this.requireSessionId();
    this.currentConfig = config;

    // Hand the runtime's optimistic user_message id to the mapper so the
    // SDK-side `message.updated` (role=user) reuses it instead of minting a
    // duplicate item id for the same prompt.
    if (options?.userMessageItemId && this.mapperState) {
      this.mapperState.pendingUserMessageItemIds.push(options.userMessageItemId);
    }

    const parts = segmentsToParts(prompt, segments, this.input.projectLocation);
    const model = parseModelSlug(config.model);
    // ThreadConfig.mode is `agent | plan | autopilot`; OpenCode's SDK uses
    // `agent` (e.g. "build", "plan") to switch between the two built-in
    // agents. Map "plan" → "plan"; everything else uses the session default.
    const agent = config.mode === "plan" ? "plan" : undefined;
    // ThreadConfig.effort → OpenCode's `variant` ("provider-specific
    // reasoning effort, e.g., high, max, minimal"). Empty string is treated
    // as "model default", so only forward truthy values.
    const variant = config.effort && config.effort.length > 0 ? config.effort : undefined;

    await acquired.client.session.promptAsync({
      sessionID,
      ...(model ? { model } : {}),
      ...(agent ? { agent } : {}),
      ...(variant ? { variant } : {}),
      ...(parts.length > 0 ? { parts } : {}),
    });
  }

  async interruptTurn(): Promise<void> {
    if (!this.acquired || !this.sessionId) return;
    try {
      await this.acquired.client.session.abort({ sessionID: this.sessionId });
    } catch {
      // Best-effort — server may already be torn down.
    }
  }

  async resolveServerRequest(requestId: ThreadServerRequestId, response: unknown): Promise<void> {
    const acquired = this.requireAcquired();
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    this.pendingRequests.delete(requestId);

    if (pending.kind === "permission") {
      const reply = parsePermissionReply(response);
      try {
        await acquired.client.permission.reply({
          requestID: pending.requestID,
          reply,
        });
      } catch {
        // Server-side may have already received another reply or aborted.
      }
      return;
    }

    if (pending.kind === "question") {
      const answers = parseQuestionAnswers(response);
      try {
        if (answers === undefined) {
          await acquired.client.question.reject({ requestID: pending.requestID });
        } else {
          await acquired.client.question.reply({
            requestID: pending.requestID,
            answers,
          });
        }
      } catch {
        // Same — best-effort reply.
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    this.sseAbort?.abort();
    this.sseAbort = undefined;

    if (this.mapperState && this.listener?.onRuntimeEvent) {
      const closing = closeOpenItems(this.mapperState);
      for (const ev of closing) this.listener.onRuntimeEvent(ev);
    }

    if (this.acquired) {
      try {
        await this.acquired.dispose();
      } finally {
        this.acquired = undefined;
      }
    }

    this.listener?.onClose();
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  private requireAcquired(): AcquiredOpenCodeServer {
    if (this.disposed || !this.acquired) {
      throw new Error("OpencodeSdkSession is not active.");
    }
    return this.acquired;
  }

  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new Error("OpencodeSdkSession.openThread has not completed.");
    }
    return this.sessionId;
  }

  private startEventStream(): void {
    const acquired = this.requireAcquired();
    const ctrl = new AbortController();
    this.sseAbort = ctrl;

    void (async () => {
      try {
        const sub = await acquired.client.event.subscribe(undefined, {
          signal: ctrl.signal,
        });
        for await (const ev of sub.stream) {
          if (this.disposed) break;
          this.handleSseEvent(ev as Event);
        }
      } catch (err) {
        if (this.disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        this.emitRuntimeEvents([
          { type: "error", threadId: this.threadId, message: `event stream: ${message}` },
        ]);
      }
    })();
  }

  private handleSseEvent(event: Event): void {
    const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID;
    if (sessionID && this.sessionId && sessionID !== this.sessionId) {
      return; // Event for another session on the same server.
    }

    if (event.type === "session.status") {
      const upd = mapStatusUpdate(event.properties);
      this.listener?.onUpdate({
        ...upd,
        ...(this.sessionId ? { sessionRef: createKnownSessionRef(this.sessionId) } : {}),
      });
      return;
    }

    if (event.type === "session.idle") {
      this.listener?.onUpdate({
        status: "idle",
        attention: "none",
        ...(this.sessionId ? { sessionRef: createKnownSessionRef(this.sessionId) } : {}),
      });
      return;
    }

    if (event.type === "permission.asked") {
      const requestId = `opencode-perm-${event.properties.id}` as ThreadServerRequestId;
      this.pendingRequests.set(requestId, {
        kind: "permission",
        requestID: event.properties.id,
      });
      this.listener?.onServerRequest({
        requestId,
        method: "permission/request",
        params: event.properties,
      });
    }

    if (event.type === "question.asked") {
      const requestId = `opencode-q-${event.properties.id}` as ThreadServerRequestId;
      this.pendingRequests.set(requestId, {
        kind: "question",
        requestID: event.properties.id,
      });
      this.listener?.onServerRequest({
        requestId,
        method: "question/request",
        params: event.properties,
      });
    }

    if (event.type === "session.error") {
      const err = event.properties.error;
      const msg =
        err && typeof err === "object" && "data" in err && err.data
          ? String((err.data as { message?: string }).message ?? err.name)
          : (err?.name ?? "OpenCode session error");
      this.listener?.onError(msg);
    }

    // Translate to canonical runtime events for the chat pane.
    if (this.mapperState) {
      const canonical = mapOpenCodeEvent(event, this.mapperState);
      if (canonical.length > 0) this.emitRuntimeEvents(canonical);
    }
  }

  private emitRuntimeEvents(events: RuntimeEvent[]): void {
    if (events.length === 0) return;
    if (!this.listener?.onRuntimeEvent) {
      this.bufferedRuntimeEvents.push(...events);
      return;
    }
    for (const ev of events) this.listener.onRuntimeEvent(ev);
  }
}

// Helpers used by resolveServerRequest. The renderer sends decisions in a
// generic shape — we accept the pieces we need and ignore the rest.

function parsePermissionReply(response: unknown): "once" | "always" | "reject" {
  if (response && typeof response === "object") {
    const obj = response as Record<string, unknown>;
    const decision = typeof obj.decision === "string" ? obj.decision : undefined;
    if (decision === "accept" || decision === "approve" || decision === "once") return "once";
    if (decision === "acceptForSession" || decision === "always") return "always";
    if (
      decision === "decline" ||
      decision === "deny" ||
      decision === "reject" ||
      decision === "cancel"
    ) {
      return "reject";
    }
    if (typeof obj.optionId === "string") {
      const id = obj.optionId.toLowerCase();
      if (id.includes("always") || id.includes("session")) return "always";
      if (id.includes("reject") || id.includes("decline") || id.includes("cancel")) return "reject";
      return "once";
    }
  }
  return "once";
}

function parseQuestionAnswers(response: unknown): Array<Array<string>> | undefined {
  if (response === undefined || response === null) return undefined;
  if (Array.isArray(response)) {
    return response.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
  }
  if (typeof response === "object") {
    const obj = response as { answers?: unknown };
    if (Array.isArray(obj.answers)) {
      return obj.answers.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)]));
    }
  }
  return undefined;
}
