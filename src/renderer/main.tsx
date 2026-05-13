import { createRoot, type Root } from "react-dom/client";
import "./styles.css";
import { readBridge } from "./bridge";
import { getAppName } from "@/shared/appName";
import {
  createRendererCrashReport,
  RendererCrashScreen,
  RendererErrorBoundary,
  type RendererCrashKind,
  type RendererCrashReport,
} from "./RendererCrashScreen";

if (import.meta.env.DEV) {
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const head = args[0];
    if (
      typeof head === "string" &&
      (head.startsWith("<Focusable>") || head.startsWith("<Pressable>")) &&
      head.includes("interactive ARIA role") &&
      (head.includes('Got "none"') || head.includes('Got "presentation"'))
    ) {
      return;
    }
    warn(...args);
  };
}

document.title = getAppName(import.meta.env.DEV);

document.documentElement.dataset.platform =
  typeof window !== "undefined" && "lightcode" in window ? readBridge().platform : "unknown";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

let reactRoot: Root | null = null;
let renderingCrashScreen = false;

function reportRootError(
  kind: "caught" | "uncaught" | "recoverable",
  error: unknown,
  errorInfo: { componentStack?: string | undefined },
) {
  const componentStack = errorInfo.componentStack?.trim();
  const prefix = `[lightcode][react:${kind}]`;

  if (kind === "recoverable") {
    console.warn(prefix, error, componentStack ?? "");
    return;
  }

  console.error(prefix, error, componentStack ?? "");
}

function renderCrashScreen(report: RendererCrashReport): void {
  if (renderingCrashScreen) return;
  renderingCrashScreen = true;
  console.error(`[lightcode][renderer:${report.kind}]`, report);
  try {
    reactRoot?.render(<RendererCrashScreen report={report} />);
  } finally {
    renderingCrashScreen = false;
  }
}

function buildSource(event: ErrorEvent): string | undefined {
  if (!event.filename) return undefined;
  const suffix =
    event.lineno > 0 ? `:${event.lineno}${event.colno > 0 ? `:${event.colno}` : ""}` : "";
  return `${event.filename}${suffix}`;
}

function showCrash(kind: RendererCrashKind, error: unknown, source?: string): void {
  renderCrashScreen(
    createRendererCrashReport({
      kind,
      error,
      ...(source ? { source } : {}),
    }),
  );
}

window.addEventListener("error", (event) => {
  if (!(event instanceof ErrorEvent)) return;
  showCrash("uncaught", event.error ?? event.message, buildSource(event));
});

window.addEventListener("unhandledrejection", (event) => {
  showCrash("unhandled-rejection", event.reason);
});

reactRoot = createRoot(root, {
  onCaughtError(error, errorInfo) {
    reportRootError("caught", error, errorInfo);
  },
  onUncaughtError(error, errorInfo) {
    reportRootError("uncaught", error, errorInfo);
    renderCrashScreen(
      createRendererCrashReport({
        kind: "react",
        error,
        ...(errorInfo.componentStack?.trim()
          ? { componentStack: errorInfo.componentStack.trim() }
          : {}),
      }),
    );
  },
  onRecoverableError(error, errorInfo) {
    reportRootError("recoverable", error, errorInfo);
  },
});

void import("./app")
  .then(({ App }) => {
    reactRoot?.render(
      <RendererErrorBoundary>
        <App />
      </RendererErrorBoundary>,
    );
  })
  .catch((error: unknown) => {
    showCrash("bootstrap", error);
  });
