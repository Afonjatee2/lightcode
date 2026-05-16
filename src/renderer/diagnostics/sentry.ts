import * as Sentry from "@sentry/electron/renderer";
import { readBridge } from "@/renderer/bridge";
import {
  buildRuntimeDiagnosticTags,
  sanitizeSentryEvent,
  type LightcodeDiagnosticTags,
  type LightcodeRuntimeDiagnosticContext,
  type SentryEventLike,
} from "@/shared/diagnostics/sentryPrivacy";

const DISABLED_INTEGRATIONS = new Set([
  "Breadcrumbs",
  "CaptureConsole",
  "Console",
  "HttpContext",
  "ReportingObserver",
]);

function buildBaseTags(): LightcodeDiagnosticTags {
  const bridge = readBridge();
  return {
    "lightcode.app_version": bridge.appVersion,
    "lightcode.channel": bridge.channel,
    "lightcode.electron": bridge.electronVersion,
    "lightcode.platform": bridge.platform,
    "lightcode.process": "renderer",
  };
}

export function initializeRendererSentry(): boolean {
  const bridge = readBridge();
  if (!bridge.sentryEnabled) {
    return false;
  }

  Sentry.init({
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    normalizeDepth: 4,
    tracesSampleRate: 0,
    initialScope: {
      tags: buildBaseTags(),
    },
    beforeBreadcrumb() {
      return null;
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event;
    },
    integrations(defaultIntegrations) {
      return defaultIntegrations.filter(
        (integration) => !DISABLED_INTEGRATIONS.has(integration.name),
      );
    },
  });

  Sentry.setContext("lightcode", {
    appVersion: bridge.appVersion,
    channel: bridge.channel,
    isDev: bridge.isDev,
    process: "renderer",
  });

  return true;
}

export function setRendererRuntimeDiagnosticContext(
  context: LightcodeRuntimeDiagnosticContext,
): void {
  if (!Sentry.isEnabled()) return;
  Sentry.getCurrentScope().setTags(buildRuntimeDiagnosticTags(context));
}

export function captureRendererException(
  error: unknown,
  context?: LightcodeRuntimeDiagnosticContext,
): void {
  if (!Sentry.isEnabled()) return;
  Sentry.withScope((scope) => {
    if (context) {
      scope.setTags(buildRuntimeDiagnosticTags(context));
    }
    Sentry.captureException(error);
  });
}
