import { app } from "electron";
import {
  sanitizeSentryEvent,
  type LightcodeDiagnosticTags,
  type SentryEventLike,
} from "@/shared/diagnostics/sentryPrivacy";
import {
  readBuildSentryDsn,
  readBuildSentryEnvironment,
} from "@/shared/diagnostics/sentryBuildConfig";

const DISABLED_INTEGRATIONS = new Set([
  "ChildProcess",
  "Console",
  "ContextLines",
  "ElectronBreadcrumbs",
  "ElectronNet",
  "LocalVariables",
  "Screenshots",
]);

type MainSentryModule = typeof import("@sentry/electron/main");

let mainSentry: MainSentryModule | null | undefined;

export type MainSentryOptions = {
  appVersion: string;
  isDev: boolean;
};

function loadMainSentry(): MainSentryModule | null {
  if (mainSentry !== undefined) {
    return mainSentry;
  }

  try {
    mainSentry = require("@sentry/electron/main") as MainSentryModule;
  } catch (error) {
    mainSentry = null;
    console.warn(
      "[lightcode] Sentry main process integration unavailable:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return mainSentry;
}

function readSentryDsn(): string | null {
  const dsn = process.env.SENTRY_DSN || readBuildSentryDsn();
  return dsn && dsn.trim().length > 0 ? dsn.trim() : null;
}

function readSentryEnvironment(options: MainSentryOptions): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    readBuildSentryEnvironment() ||
    (options.isDev ? "development" : "production")
  );
}

function shouldEnableSentry(options: MainSentryOptions): boolean {
  if (!readSentryDsn()) return false;
  if (!options.isDev) return true;
  return process.env.SENTRY_ENABLE_DEV === "1";
}

function buildBaseTags(options: MainSentryOptions): LightcodeDiagnosticTags {
  return {
    "lightcode.app_version": options.appVersion,
    "lightcode.arch": process.arch,
    "lightcode.chrome": process.versions.chrome ?? "unknown",
    "lightcode.electron": process.versions.electron ?? "unknown",
    "lightcode.node": process.versions.node,
    "lightcode.platform": process.platform,
    "lightcode.process": "main",
  };
}

export function isSentryConfigured(options: MainSentryOptions): boolean {
  return shouldEnableSentry(options);
}

export function initializeMainSentry(options: MainSentryOptions): boolean {
  const dsn = readSentryDsn();
  if (!dsn || !shouldEnableSentry(options)) {
    return false;
  }

  const Sentry = loadMainSentry();
  if (!Sentry) {
    return false;
  }

  Sentry.init({
    dsn,
    release: `lightcode@${options.appVersion}`,
    environment: readSentryEnvironment(options),
    sendDefaultPii: false,
    attachScreenshot: false,
    maxBreadcrumbs: 0,
    normalizeDepth: 4,
    tracesSampleRate: 0,
    debug: process.env.SENTRY_DEBUG === "1",
    initialScope: {
      tags: buildBaseTags(options),
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
    appVersion: options.appVersion,
    packaged: app.isPackaged,
    process: "main",
  });

  return true;
}

export function captureMainException(error: unknown, tags?: LightcodeDiagnosticTags): void {
  const Sentry = loadMainSentry();
  if (!Sentry) return;
  if (!Sentry.isEnabled()) return;
  Sentry.withScope((scope) => {
    if (tags) {
      scope.setTags(tags);
    }
    Sentry.captureException(error);
  });
}
