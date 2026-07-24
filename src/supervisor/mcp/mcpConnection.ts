import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpProbeError, McpServer } from "@/shared/contracts";

export const CLEANUP_TIMEOUT_MS = 1_000;

export type McpClientTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  | SSEClientTransport;

export interface AuthObservation {
  status?: number;
  scheme?: McpProbeError["authScheme"];
}

/**
 * Strips control characters and truncates untrusted server-provided metadata
 * before it can reach logs, UI, or IPC payloads.
 */
export function safeMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  })
    .join("")
    .trim()
    .slice(0, 200);
  return sanitized || undefined;
}

function authSchemeFromChallenge(value: string | null): McpProbeError["authScheme"] {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("resource_metadata=") || normalized.includes("resource-metadata=")) {
    return "oauth";
  }
  if (normalized.startsWith("bearer") || normalized.includes(", bearer")) return "bearer";
  return "other";
}

function observedFetch(observation: AuthObservation): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const challenge = response.headers.get("www-authenticate");
    if (response.status === 401 || (response.status === 403 && challenge !== null)) {
      observation.status = response.status;
      observation.scheme = authSchemeFromChallenge(challenge);
    }
    return response;
  };
}

/** Builds the MCP SDK client transport matching a resolved `McpServer` config. */
export function createMcpClientTransport(
  server: McpServer,
  observation: AuthObservation,
): McpClientTransport {
  const transport = server.transport;
  if (transport.type === "stdio") {
    return new StdioClientTransport({
      command: transport.command,
      args: transport.args,
      env: transport.env,
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      // Never copy an MCP server's stderr into Poracode logs.
      stderr: "ignore",
    });
  }

  const fetchWithAuthObservation = observedFetch(observation);
  if (transport.type === "http") {
    return new StreamableHTTPClientTransport(new URL(transport.url), {
      requestInit: { headers: transport.headers },
      fetch: fetchWithAuthObservation,
      reconnectionOptions: {
        initialReconnectionDelay: 100,
        maxReconnectionDelay: 500,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });
  }

  return new SSEClientTransport(new URL(transport.url), {
    requestInit: { headers: transport.headers },
    fetch: fetchWithAuthObservation,
  });
}

export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeClientWithTimeout(client: Client): Promise<void> {
  await settleWithin(
    client.close().catch(() => undefined),
    CLEANUP_TIMEOUT_MS,
  );
}

function errorCode(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

/**
 * Classifies a connection/handshake failure into the safe, credential-free
 * `McpProbeError` shape shared by probing and tool-call call sites.
 */
export function classifyMcpConnectionFailure(
  error: unknown,
  observation: AuthObservation,
  timedOut: boolean,
): McpProbeError {
  if (timedOut || (error instanceof McpError && error.code === ErrorCode.RequestTimeout)) {
    return { code: "timeout", message: "Connection timed out." };
  }

  if (
    error instanceof UnauthorizedError ||
    (error instanceof McpError &&
      /unauthori[sz]ed|authentication required/iu.test(error.message)) ||
    observation.status === 401 ||
    observation.status === 403 ||
    (error instanceof StreamableHTTPError && error.code === 401) ||
    (error instanceof SseError && error.code === 401)
  ) {
    return {
      code: "auth-required",
      message: "Authentication is required.",
      authScheme: observation.scheme ?? "unknown",
    };
  }

  const code = errorCode(error);
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
    return { code: "command-not-found", message: "The server command could not be started." };
  }

  if (
    error instanceof SyntaxError ||
    error instanceof McpError ||
    (error instanceof Error &&
      /invalid|protocol version|does not support tools/iu.test(error.message))
  ) {
    return { code: "protocol-error", message: "The server returned an invalid MCP response." };
  }

  return { code: "connection-failed", message: "Could not connect to the MCP server." };
}
