import {
  CreateElicitationRequest as AcpCreateElicitationRequest,
  type CompleteElicitationNotification,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { RuntimeEvent, ThreadConfig, ThreadServerRequestId } from "@/shared/contracts";
import {
  mapAcpElicitationRequest,
  mapAcpPermissionRequest,
  type AcpMapperState,
} from "./canonicalMapping";
import {
  buildAcpElicitationAnswerEvents,
  normalizeAcpElicitationResponse,
} from "./sessionElicitation";
import {
  hasNativeAcpPermissionMode,
  selectAutoApprovedPermissionOption,
} from "./sessionPermissionMode";

type RequestAttention = "needs_approval" | "needs_reply";

interface AcpSessionRequestsOptions {
  threadId: string;
  getPermissionContext: () => {
    config: ThreadConfig | undefined;
    availableModeIds: string[];
  };
  ensureMapperState: () => AcpMapperState;
  emitRuntimeEvents: (events: RuntimeEvent[]) => void;
  setRequestAttention: (attention: RequestAttention) => void;
}

interface PendingElicitation {
  resolve: (response: unknown) => void;
  elicitationId?: string;
  request: CreateElicitationRequest;
}

/** Owns the pending ACP requests that block an agent until the client responds. */
export class AcpSessionRequests {
  private readonly pendingPermissionResolvers = new Map<
    ThreadServerRequestId,
    (response: unknown) => void
  >();
  private readonly pendingElicitationResolvers = new Map<
    ThreadServerRequestId,
    PendingElicitation
  >();
  private readonly pendingElicitationRequestIdsByElicitationId = new Map<
    string,
    ThreadServerRequestId
  >();
  private permissionRequestSeq = 0;
  private elicitationRequestSeq = 0;

  constructor(private readonly options: AcpSessionRequestsOptions) {}

  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.shouldAutoApproveSyntheticPermissionRequest()) {
      const optionId = selectAutoApprovedPermissionOption(params);
      if (optionId) {
        return Promise.resolve({ outcome: { outcome: "selected", optionId } });
      }
    }

    return new Promise<RequestPermissionResponse>((resolve) => {
      const requestId = `acp-perm-${this.permissionRequestSeq++}`;

      this.pendingPermissionResolvers.set(requestId, (response: unknown) => {
        const selected = response as { optionId?: string } | undefined;
        if (selected?.optionId) {
          resolve({ outcome: { outcome: "selected", optionId: selected.optionId } });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
      });

      this.options.emitRuntimeEvents([
        mapAcpPermissionRequest(params, this.options.ensureMapperState(), String(requestId)),
      ]);
      this.options.setRequestAttention("needs_approval");
    });
  }

  createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    return new Promise<CreateElicitationResponse>((resolve) => {
      const requestId = `acp-elicit-${this.elicitationRequestSeq++}`;
      const urlElicitationId = AcpCreateElicitationRequest.isUrl(params)
        ? params.elicitationId
        : undefined;

      this.pendingElicitationResolvers.set(requestId, {
        resolve: (response: unknown) => {
          resolve(normalizeAcpElicitationResponse(response, params));
        },
        request: params,
        ...(urlElicitationId !== undefined ? { elicitationId: urlElicitationId } : {}),
      });

      if (urlElicitationId !== undefined) {
        this.pendingElicitationRequestIdsByElicitationId.set(urlElicitationId, requestId);
      }

      this.options.emitRuntimeEvents([
        mapAcpElicitationRequest(params, this.options.ensureMapperState(), String(requestId)),
      ]);
      this.options.setRequestAttention("needs_reply");
    });
  }

  completeElicitation(params: CompleteElicitationNotification): void {
    const requestId = this.pendingElicitationRequestIdsByElicitationId.get(params.elicitationId);
    if (!requestId) return;
    if (this.resolvePendingElicitationRequest(requestId, { action: "accept" })) {
      this.options.emitRuntimeEvents([
        {
          type: "request.resolved",
          threadId: this.options.threadId,
          requestId: String(requestId),
          outcome: "answered",
        },
      ]);
    }
  }

  resolve(requestId: ThreadServerRequestId, response: unknown): void {
    const permissionResolver = this.pendingPermissionResolvers.get(requestId);
    if (permissionResolver) {
      this.pendingPermissionResolvers.delete(requestId);
      permissionResolver(response);
      return;
    }
    this.resolvePendingElicitationRequest(requestId, response);
  }

  cancelPending(): void {
    const cancelledIds: ThreadServerRequestId[] = [];
    for (const [requestId, resolver] of this.pendingPermissionResolvers) {
      cancelledIds.push(requestId);
      resolver({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissionResolvers.clear();

    for (const [requestId, entry] of this.pendingElicitationResolvers) {
      cancelledIds.push(requestId);
      if (entry.elicitationId !== undefined) {
        this.pendingElicitationRequestIdsByElicitationId.delete(entry.elicitationId);
      }
      entry.resolve({ action: "cancel" });
    }
    this.pendingElicitationResolvers.clear();

    if (cancelledIds.length > 0) {
      this.options.emitRuntimeEvents(
        cancelledIds.map((requestId) => ({
          type: "request.resolved",
          threadId: this.options.threadId,
          requestId: String(requestId),
          outcome: "cancelled",
        })),
      );
    }
  }

  private shouldAutoApproveSyntheticPermissionRequest(): boolean {
    const { config, availableModeIds } = this.options.getPermissionContext();
    const policy = config?.approvalPolicy;
    if (!config || config.mode === "plan" || !policy) return false;
    if (policy !== "never" && policy !== "yolo" && policy !== "bypassPermissions") return false;
    return !hasNativeAcpPermissionMode(policy, availableModeIds);
  }

  private resolvePendingElicitationRequest(
    requestId: ThreadServerRequestId,
    response: unknown,
  ): boolean {
    const entry = this.pendingElicitationResolvers.get(requestId);
    if (!entry) return false;
    this.pendingElicitationResolvers.delete(requestId);
    if (entry.elicitationId !== undefined) {
      this.pendingElicitationRequestIdsByElicitationId.delete(entry.elicitationId);
    }
    entry.resolve(response);
    this.options.emitRuntimeEvents(
      buildAcpElicitationAnswerEvents({
        threadId: this.options.threadId,
        itemId: `acp-question-answer-${String(requestId)}`,
        request: entry.request,
        response,
      }),
    );
    return true;
  }
}
