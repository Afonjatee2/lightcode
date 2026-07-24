/**
 * Client for the hosted push gateway. The desktop cannot talk to APNs directly
 * (that needs the team's `.p8` auth key, which can't ship in the app), so a
 * small stateless gateway holds provider credentials and forwards to APNs, FCM,
 * or a standards-based Web Push service. We relay provider status so callers
 * can prune expired registrations.
 */

import type { RemoteWebPushSubscription } from "@/shared/remote";

/** Production gateway origin (co-hosted with the marketing site / PWA). The
 * canonical domain is `website/src/lib/seo.ts` `SITE_URL`. */
const DEFAULT_PUSH_GATEWAY_URL = "https://poracode.com";

/** Resolve the gateway origin: env override, else the production default. */
export function resolvePushGatewayUrl(): string {
  const fromEnv = process.env.PORACODE_PUSH_GATEWAY_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PUSH_GATEWAY_URL;
}

interface NativeSendPushInput {
  /** APNs token: device token (alert) or activity/push-to-start token (liveactivity). */
  readonly token: string;
  /**
   * Target platform. iOS payloads are raw APNs envelopes forwarded as-is;
   * Android payloads are the `{ title, body, threadId, silent? }` status shape
   * the gateway wraps into an FCM **notification** message. Sent explicitly on
   * every call (gateway defaults to `"ios"` server-side).
   */
  readonly platform: "ios" | "android";
  readonly pushType: "liveactivity" | "alert";
  /** JSON push payload: iOS `{ aps: { ... } }` or the Android status payload. */
  readonly payload: unknown;
  /** APNs `apns-priority` (5 = throttled, 10 = immediate). */
  readonly priority?: number;
  /** APNs `apns-collapse-id`, for coalescing. */
  readonly collapseId?: string;
  /** APNs `apns-expiration` (epoch seconds). */
  readonly expiration?: number;
}

interface WebSendPushInput {
  readonly platform: "web";
  readonly subscription: RemoteWebPushSubscription;
  readonly pushType: "alert";
  /** `{ title, body, threadId, url }`, displayed by the PWA service worker. */
  readonly payload: unknown;
  readonly priority?: number;
  readonly collapseId?: string;
  readonly expiration?: number;
}

export type SendPushInput = NativeSendPushInput | WebSendPushInput;

export interface SendPushResult {
  readonly ok: boolean;
  /** HTTP status from the gateway/provider; `0` on a network error. */
  readonly status: number;
  /** The provider reported the registration is gone (404/410) — prune it. */
  readonly unregistered: boolean;
  readonly reason?: string;
}

export type SendPush = (input: SendPushInput) => Promise<SendPushResult>;

type FetchLike = (
  url: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

export interface CreatePushGatewayOptions {
  /** Gateway origin; defaults to {@link resolvePushGatewayUrl}. */
  readonly gatewayUrl?: string;
  /** Injectable fetch (tests); defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Per-request timeout; defaults to 10s. */
  readonly timeoutMs?: number;
  /** Structured-log sink for gateway failures. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_GATEWAY_TIMEOUT_MS = 10_000;

interface GatewayTransport {
  /** Absolute `/api/push` URL on the resolved gateway origin. */
  readonly endpoint: string;
  /** Run one request against the gateway, aborting it after the timeout. */
  request(init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;
}

/**
 * Resolve the gateway origin, fetch impl, and timeout once, and expose a
 * timeout-guarded request runner. Shared by {@link createPushGateway} and
 * {@link createWebPushPublicKeyResolver} so the `/api/push` URL and the
 * abort/timeout dance have one source of truth. `/api/push` is root-absolute,
 * so only `base`'s origin matters (no trailing-slash fixup needed).
 */
function createGatewayTransport(options: CreatePushGatewayOptions): GatewayTransport {
  const base = options.gatewayUrl ?? resolvePushGatewayUrl();
  const doFetch: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const timeoutMs = options.timeoutMs ?? DEFAULT_GATEWAY_TIMEOUT_MS;
  const endpoint = new URL("/api/push", base).toString();
  return {
    endpoint,
    async request(init) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await doFetch(endpoint, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Builds a {@link SendPush} that posts to the gateway. It never throws: network
 * errors and non-OK statuses are returned as a {@link SendPushResult} so the
 * coordinator can decide whether to prune (410) or ignore (transient).
 */
export function createPushGateway(options: CreatePushGatewayOptions = {}): SendPush {
  const transport = createGatewayTransport(options);
  return async (input: SendPushInput): Promise<SendPushResult> => {
    try {
      const response = await transport.request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(input.platform === "web"
            ? { subscription: input.subscription }
            : { token: input.token }),
          platform: input.platform,
          pushType: input.pushType,
          payload: input.payload,
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.collapseId ? { collapseId: input.collapseId } : {}),
          ...(input.expiration !== undefined ? { expiration: input.expiration } : {}),
        }),
      });
      return {
        ok: response.ok,
        status: response.status,
        unregistered:
          response.status === 410 || (input.platform === "web" && response.status === 404),
      };
    } catch (error) {
      options.onError?.(error);
      return {
        ok: false,
        status: 0,
        unregistered: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

export type ResolveWebPushPublicKey = () => Promise<string>;

/**
 * Resolves the public VAPID application-server key from the hosted gateway.
 * The desktop proxies this public value to authenticated mobile clients so
 * hosted, relayed, and local PWAs use one subscription key.
 */
export function createWebPushPublicKeyResolver(
  options: CreatePushGatewayOptions = {},
): ResolveWebPushPublicKey {
  const transport = createGatewayTransport(options);
  const fetchPublicKey = async (): Promise<string> => {
    try {
      const response = await transport.request({ method: "GET" });
      if (!response.ok || !response.json) {
        throw new Error(`Web Push config request failed with status ${response.status}.`);
      }
      const body = (await response.json()) as { publicKey?: unknown };
      if (typeof body.publicKey !== "string" || body.publicKey.length === 0) {
        throw new Error("Web Push config response did not include a public key.");
      }
      return body.publicKey;
    } catch (error) {
      options.onError?.(error);
      throw error;
    }
  };

  // The public VAPID key is constant for the gateway, but the config endpoint
  // is hit on every `/api/push/config` request and on every client reconnect.
  // Cache the resolved (or in-flight) promise so those collapse into one fetch;
  // drop it on failure so a transient error still retries on the next call.
  let cached: Promise<string> | null = null;
  return () => {
    if (!cached) {
      cached = fetchPublicKey().catch((error) => {
        cached = null;
        throw error;
      });
    }
    return cached;
  };
}
