const RESIZE_OBSERVER_LOOP_MESSAGES = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

export function isResizeObserverLoopError(error: unknown): boolean {
  const message = readErrorMessage(error);
  return message !== null && RESIZE_OBSERVER_LOOP_MESSAGES.has(message);
}

export function isIgnorableWindowError(event: ErrorEvent): boolean {
  return isResizeObserverLoopError(event.error) || isResizeObserverLoopError(event.message);
}
