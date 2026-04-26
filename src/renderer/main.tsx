import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles.css";
import { readBridge } from "./bridge";
import { getAppName } from "@/shared/appName";

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

document.documentElement.dataset.platform = readBridge().platform;

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

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

createRoot(root, {
  onCaughtError(error, errorInfo) {
    reportRootError("caught", error, errorInfo);
  },
  onUncaughtError(error, errorInfo) {
    reportRootError("uncaught", error, errorInfo);
  },
  onRecoverableError(error, errorInfo) {
    reportRootError("recoverable", error, errorInfo);
  },
}).render(<App />);
