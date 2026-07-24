import type {
  ControlCentreProposal,
  ControlCentreDeploymentClient,
  ListProposalsFilter,
  ApprovePayload,
  RejectPayload,
} from "./types";
import { listProposalsFilterSchema, approvePayloadSchema, rejectPayloadSchema } from "./types";
import { adaptProposal, adaptProposalList } from "./controlCentreAdapter";

// ---------------------------------------------------------------------------
// HTTP transport interface — injectable so the client can be backed by
// Control Centre REST API, MCP tools, or in-memory fixtures for tests.
// ---------------------------------------------------------------------------
export interface DeploymentHttpTransport {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Options for constructing the client
// ---------------------------------------------------------------------------
export interface ControlCentreClientOptions {
  transport?: DeploymentHttpTransport;
  baseUrl?: string | (() => Promise<string>);
}

// ---------------------------------------------------------------------------
// Fetch-based transport (default when no custom transport provided)
// ---------------------------------------------------------------------------
export function createFetchTransport(baseUrl: string): DeploymentHttpTransport {
  const normalised = baseUrl.replace(/\/$/, "");
  return {
    async get(path: string) {
      const res = await fetch(`${normalised}${path}`);
      if (!res.ok) {
        throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
    async post(path: string, body?: unknown) {
      const res = await fetch(`${normalised}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : null,
      });
      if (!res.ok) {
        throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
  };
}

// ---------------------------------------------------------------------------
// Control Centre Deployment Client
//
// This is the ONLY class Poracode should use to interact with Control
// Centre proposals. It deliberately omits any apply/platform-write
// method — the server owns that path exclusively.
// ---------------------------------------------------------------------------
export class ControlCentreClient implements ControlCentreDeploymentClient {
  private transport: DeploymentHttpTransport;

  constructor(options: ControlCentreClientOptions = {}) {
    if (options.transport) {
      this.transport = options.transport;
    } else {
      const baseUrl =
        typeof options.baseUrl === "string" ? options.baseUrl : "http://localhost:3001";
      this.transport = createFetchTransport(baseUrl);
    }
  }

  /** Replace the transport at runtime — useful for wiring up MCP-backed transport or test fakes. */
  setTransport(transport: DeploymentHttpTransport): this {
    this.transport = transport;
    return this;
  }

  /** Resolve a base URL asynchronously and replace the current transport. */
  async replaceTransportWithUrl(resolver: () => Promise<string>): Promise<void> {
    const url = await resolver();
    this.transport = createFetchTransport(url);
  }

  // ---- read operations ----

  async listProposals(filter: ListProposalsFilter): Promise<ControlCentreProposal[]> {
    const parsed = listProposalsFilterSchema.parse(filter);
    const params = new URLSearchParams();
    if (parsed.status) params.set("status", parsed.status);
    const qs = params.toString();
    const raw = await this.transport.get(
      `/campaign-groups/${parsed.campaignGroupId}/action-proposals${qs ? `?${qs}` : ""}`,
    );
    return adaptProposalList(raw);
  }

  async getProposal(id: string): Promise<ControlCentreProposal> {
    const raw = await this.transport.get(`/action-proposals/${id}`);
    return adaptProposal(raw);
  }

  async refreshProposal(id: string): Promise<ControlCentreProposal> {
    return this.getProposal(id);
  }

  // ---- write operations (approval only — no apply) ----

  async approveProposal(payload: ApprovePayload): Promise<ControlCentreProposal> {
    const parsed = approvePayloadSchema.parse(payload);
    const body: Record<string, unknown> = {};
    if (parsed.approvalNote !== undefined) body.approvalNote = parsed.approvalNote;
    if (parsed.strongConfirmation !== undefined)
      body.strongConfirmation = parsed.strongConfirmation;
    const raw = await this.transport.post(`/action-proposals/${parsed.id}/approve`, body);
    return adaptProposal(raw);
  }

  async rejectProposal(payload: RejectPayload): Promise<ControlCentreProposal> {
    const parsed = rejectPayloadSchema.parse(payload);
    const body: Record<string, unknown> = {};
    if (parsed.rejectionReason !== undefined) body.rejectionReason = parsed.rejectionReason;
    const raw = await this.transport.post(`/action-proposals/${parsed.id}/reject`, body);
    return adaptProposal(raw);
  }
}

// ---------------------------------------------------------------------------
// Fixture / in-memory client for testing
// ---------------------------------------------------------------------------
export class FixtureDeploymentClient implements ControlCentreDeploymentClient {
  private proposals: Map<string, ControlCentreProposal> = new Map();

  constructor(initialProposals: ControlCentreProposal[] = []) {
    for (const p of initialProposals) {
      this.proposals.set(p.id, p);
    }
  }

  async listProposals(filter: ListProposalsFilter): Promise<ControlCentreProposal[]> {
    const results: ControlCentreProposal[] = [];
    for (const p of this.proposals.values()) {
      if (p.campaignGroupId !== filter.campaignGroupId) continue;
      if (filter.status && p.status !== filter.status) continue;
      results.push(p);
    }
    return results;
  }

  async getProposal(id: string): Promise<ControlCentreProposal> {
    const p = this.proposals.get(id);
    if (!p) throw new Error(`Proposal ${id} not found`);
    return p;
  }

  async refreshProposal(id: string): Promise<ControlCentreProposal> {
    return this.getProposal(id);
  }

  async approveProposal(payload: ApprovePayload): Promise<ControlCentreProposal> {
    const p = this.proposals.get(payload.id);
    if (!p) throw new Error(`Proposal ${payload.id} not found`);
    if (p.status !== "awaiting_approval") {
      throw new Error(`Cannot approve proposal in status: ${p.status}`);
    }
    if (p.requiresStrongConfirmation && !payload.strongConfirmation) {
      throw new Error("Strong confirmation required for high-risk proposal");
    }
    const updated: ControlCentreProposal = {
      ...p,
      status: "approved",
      approvalNote: payload.approvalNote ?? p.approvalNote,
      approvedAt: new Date().toISOString(),
    };
    this.proposals.set(payload.id, updated);
    return updated;
  }

  async rejectProposal(payload: RejectPayload): Promise<ControlCentreProposal> {
    const p = this.proposals.get(payload.id);
    if (!p) throw new Error(`Proposal ${payload.id} not found`);
    if (p.status !== "awaiting_approval") {
      throw new Error(`Cannot reject proposal in status: ${p.status}`);
    }
    const updated: ControlCentreProposal = {
      ...p,
      status: "rejected",
      rejectionReason: payload.rejectionReason ?? null,
      rejectedAt: new Date().toISOString(),
    };
    this.proposals.set(payload.id, updated);
    return updated;
  }

  /** Clear and re-seed — for test isolation */
  seed(proposals: ControlCentreProposal[]): void {
    this.proposals.clear();
    for (const p of proposals) {
      this.proposals.set(p.id, p);
    }
  }
}
