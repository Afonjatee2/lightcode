import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TerminalSize, ThreadStatus } from "@/shared/contracts";
import { XTermSurface, type XTermSurfaceHandle } from "@/renderer/components/terminal/XTermSurface";

export interface TerminalPaneHandle {
  focus(): void;
}

export const TerminalPane = forwardRef<
  TerminalPaneHandle,
  {
    threadId: string;
    status: ThreadStatus;
    onTerminalResize?: (size: TerminalSize) => void;
  }
>(function TerminalPane(props, ref) {
  const { threadId, status, onTerminalResize } = props;
  const xtermRef = useRef<XTermSurfaceHandle>(null);
  const prevStatusRef = useRef(status);

  useImperativeHandle(ref, () => ({
    focus() {
      xtermRef.current?.focus();
    },
  }));

  // Auto-focus the terminal when the agent needs user interaction (plan
  // questions, approval prompts) so arrow-key navigation works immediately.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((status === "needs_reply" || status === "needs_approval") && prev !== status) {
      xtermRef.current?.focus();
    }
  }, [status]);

  const isTerminalActive = status !== "inactive";

  return (
    <div
      className={`h-full w-full overflow-visible transition-opacity duration-300 ease-out ${
        status === "inactive" || status === "launching" ? "opacity-0" : "opacity-100"
      }`}
    >
      <XTermSurface
        ref={xtermRef}
        terminalId={threadId}
        enabled={isTerminalActive}
        {...(onTerminalResize ? { onTerminalResize } : {})}
      />
    </div>
  );
});
