import * as Sentry from "@sentry/node";
import {
  sanitizeSentryEvent,
  type LightcodeDiagnosticTags,
  type SentryEventLike,
} from "@/shared/diagnostics/sentryPrivacy";
import {
  readBuildSentryDsn,
  readBuildSentryEnvironment,
} from "@/shared/diagnostics/sentryBuildConfig";

export type SupervisorSentryOptions = {
  appVersion: string;
  isDev: boolean;
};

function readSentryDsn(): string | null {
  const dsn = process.env.SENTRY_DSN || readBuildSentryDsn();
  return dsn && dsn.trim().length > 0 ? dsn.trim() : null;
}

function readSentryEnvironment(options: SupervisorSentryOptions): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    readBuildSentryEnvironment() ||
    (options.isDev ? "development" : "production")
  );
}

function buildBaseTags(options: SupervisorSentryOptions): LightcodeDiagnosticTags {
  return {
    "lightcode.app_version": options.appVersion,
    "lightcode.arch": process.arch,
    "lightcode.node": process.versions.node,
    "lightcode.platform": process.platform,
    "lightcode.process": "supervisor",
  };
}

export function initializeSupervisorSentry(options: SupervisorSentryOptions): boolean {
  const dsn = readSentryDsn();
  if (!dsn) {
    return false;
  }

  Sentry.init({
    dsn,
    release: `lightcode@${options.appVersion}`,
    environment: readSentryEnvironment(options),
    sendDefaultPii: false,
    defaultIntegrations: false,
    maxBreadcrumbs: 0,
    normalizeDepth: 4,
    tracesSampleRate: 0,
    debug: process.env.SENTRY_DEBUG === "1",
    initialScope: {
      tags: buildBaseTags(options),
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event;
    },
  });

  Sentry.setContext("lightcode", {
    appVersion: options.appVersion,
    process: "supervisor",
  });

  return true;
}

export function captureSupervisorException(error: unknown, tags?: LightcodeDiagnosticTags): void {
  if (!Sentry.isEnabled()) return;
  Sentry.withScope((scope) => {
    if (tags) {
      scope.setTags(tags);
    }
    Sentry.captureException(error);
  });
}

export async function flushSupervisorSentry(timeoutMs = 2000): Promise<void> {
  if (!Sentry.isEnabled()) return;
  await Sentry.flush(timeoutMs);
}
