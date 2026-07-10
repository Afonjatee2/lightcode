import {
  sanitizeProductAnalyticsEvent,
  type ProductAnalyticsEventName,
  type ProductAnalyticsProperties,
} from "@/shared/analytics/posthogPrivacy";

const FLUSH_BATCH_SIZE = 20;
const MAX_BUFFERED_EVENTS = 1_000;

export interface PostHogClientConfig {
  apiKey: string;
  host: string;
  enabled: boolean;
}

interface BufferedProductEvent {
  event: ProductAnalyticsEventName;
  properties: Record<string, string | number | boolean | null>;
  capturedAt: string;
}

export interface PostHogClientDependencies {
  resolveConfig: () => PostHogClientConfig;
  resolveInstallId: () => string;
  buildBaseProperties: (sessionId: string) => ProductAnalyticsProperties;
  createSessionId: () => string;
  now: () => string;
  fetch: typeof fetch;
}

export interface PostHogClient {
  configure: () => boolean;
  capture: (event: ProductAnalyticsEventName, properties?: ProductAnalyticsProperties) => void;
  flush: () => Promise<void>;
}

export function createPostHogClient(dependencies: PostHogClientDependencies): PostHogClient {
  let config: PostHogClientConfig | null = null;
  let installId: string | null = null;
  let baseProperties: ProductAnalyticsProperties | null = null;
  const sessionId = dependencies.createSessionId();
  const buffer: BufferedProductEvent[] = [];
  let flushPromise: Promise<void> | null = null;

  const configure = (): boolean => {
    config = dependencies.resolveConfig();
    if (!config.enabled) return false;
    installId ??= dependencies.resolveInstallId();
    return installId.length > 0;
  };

  const ensureConfig = (): PostHogClientConfig | null => {
    if (!config && !configure()) return null;
    if (!config?.enabled || !installId) return null;
    return config;
  };

  const capture: PostHogClient["capture"] = (event, properties = {}) => {
    if (!ensureConfig() || !installId) return;
    // Base properties are session-static, so build them once per client.
    baseProperties ??= dependencies.buildBaseProperties(sessionId);
    const sanitized = sanitizeProductAnalyticsEvent(event, {
      ...baseProperties,
      ...properties,
    });
    if (!sanitized) return;

    buffer.push({
      event: sanitized.event,
      properties: sanitized.properties,
      capturedAt: dependencies.now(),
    });
    if (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
    }
    if (buffer.length >= FLUSH_BATCH_SIZE) {
      void flush();
    }
  };

  const flushBatch = async (): Promise<void> => {
    const activeConfig = ensureConfig();
    if (!activeConfig || !installId || buffer.length === 0) return;

    const batch = buffer.splice(0, FLUSH_BATCH_SIZE);
    try {
      const response = await dependencies.fetch(`${activeConfig.host}/batch/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          api_key: activeConfig.apiKey,
          batch: batch.map((item) => ({
            event: item.event,
            distinct_id: installId,
            properties: item.properties,
            timestamp: item.capturedAt,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(`PostHog batch failed with status ${response.status}`);
      }
    } catch {
      buffer.unshift(...batch);
      if (buffer.length > MAX_BUFFERED_EVENTS) {
        buffer.splice(MAX_BUFFERED_EVENTS);
      }
    }
  };

  const flush = async (): Promise<void> => {
    if (flushPromise) {
      await flushPromise;
      return;
    }

    flushPromise = flushBatch().finally(() => {
      flushPromise = null;
    });
    await flushPromise;
  };

  return { capture, configure, flush };
}
