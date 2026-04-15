import type { ProjectLocation } from "./contracts";

// ── LSP IPC payload types ───────────────────────────────────

export interface LspStartPayload {
  /** Unique session key, e.g. "projectId:typescript" */
  sessionId: string;
  projectLocation: ProjectLocation;
  /** Language identifier — maps to a server config in the registry */
  languageId: string;
}

export interface LspStopPayload {
  sessionId: string;
}

export interface LspMessagePayload {
  sessionId: string;
  /** Raw JSON-RPC message to forward to the language server */
  message: unknown;
}

export type LspSessionStatus = "starting" | "ready" | "error" | "stopped";
