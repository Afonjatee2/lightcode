import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { MessageSquare, TerminalSquare } from "lucide-react";
import type { ThreadPresentationMode } from "@/shared/contracts";

export interface PresentationModeTabsProps {
  presentationMode: ThreadPresentationMode;
  onChange: (next: ThreadPresentationMode) => void;
  /** When false, the CLI tab renders disabled. */
  supportsTerminal: boolean;
  /** When false, the Chat tab renders disabled. */
  supportsGui: boolean;
  className?: string;
}

export function PresentationModeTabs(props: PresentationModeTabsProps) {
  const { presentationMode, onChange, supportsTerminal, supportsGui, className } = props;

  const [internalMode, setInternalMode] = useState(presentationMode);
  const [animating, setAnimating] = useState(false);
  const [activeText, setActiveText] = useState<ThreadPresentationMode | null>(presentationMode);

  const isInitialMount = useRef(true);
  const guiTabRef = useRef<HTMLButtonElement>(null);
  const terminalTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setActiveText(null);
    setAnimating(true);

    const t1 = setTimeout(() => {
      setInternalMode(presentationMode);
    }, 10);

    // Lightball reaches the "start" of the target text early in its flight;
    // dissolve it and ignite the text just before the ball arrives.
    const t2 = setTimeout(() => {
      setAnimating(false);
      setActiveText(presentationMode);
    }, 80);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [presentationMode]);

  function focusMode(mode: ThreadPresentationMode) {
    const ref = mode === "gui" ? guiTabRef : terminalTabRef;
    ref.current?.focus();
  }

  function selectMode(mode: ThreadPresentationMode) {
    if (mode === "gui" && !supportsGui) return;
    if (mode === "terminal" && !supportsTerminal) return;
    if (presentationMode !== mode) onChange(mode);
    focusMode(mode);
  }

  function enabledModes(): ThreadPresentationMode[] {
    return [
      ...(supportsGui ? (["gui"] as const) : []),
      ...(supportsTerminal ? (["terminal"] as const) : []),
    ];
  }

  function handleTabListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const modes = enabledModes();
    if (modes.length === 0) return;
    const currentIndex = Math.max(0, modes.indexOf(presentationMode));
    let nextMode: ThreadPresentationMode | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextMode = modes[(currentIndex + 1) % modes.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextMode = modes[(currentIndex - 1 + modes.length) % modes.length];
        break;
      case "Home":
        nextMode = modes[0];
        break;
      case "End":
        nextMode = modes[modes.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextMode) selectMode(nextMode);
  }

  return (
    <div className={`${className} flex justify-center`}>
      <div
        className="relative flex w-[140px] h-7 rounded-full border border-border/15 bg-surface-tertiary/40 p-0.5 backdrop-blur-md"
        role="tablist"
        aria-label="Thread mode"
        onKeyDown={handleTabListKeyDown}
      >
        {/* Custom Flying Lightball */}
        <div
          className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] pointer-events-none flex items-center justify-center transition-transform duration-[250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            internalMode === "terminal" ? "translate-x-[calc(100%+4px)]" : "translate-x-0"
          }`}
          style={{ left: "2px" }}
        >
          <div
            className={`w-[70%] h-[90%] rounded-full transition-all duration-80 ${
              animating ? "opacity-80 scale-100 blur-[3px]" : "opacity-0 scale-50 blur-[6px]"
            }`}
            style={{
              background:
                "radial-gradient(circle at center, var(--foreground) 0%, color-mix(in oklab, var(--foreground) 40%, transparent) 30%, transparent 65%)",
            }}
          />
        </div>

        <button
          ref={guiTabRef}
          type="button"
          role="tab"
          aria-selected={presentationMode === "gui"}
          tabIndex={presentationMode === "gui" ? 0 : -1}
          disabled={!supportsGui}
          onClick={() => selectMode("gui")}
          className="relative h-full flex-1 flex justify-center items-center outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-full focus-visible:ring-2 focus-visible:ring-focus/50"
        >
          <span
            className={`relative z-10 flex w-full items-center justify-center gap-1.5 text-[11px] font-semibold tracking-tight transition-colors duration-200 ${
              activeText === "gui" ? "text-foreground" : "text-muted/60"
            }`}
          >
            <MessageSquare className="size-3" />
            Chat
          </span>
        </button>

        <div className="w-[1px] h-3 bg-foreground/20 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />

        <button
          ref={terminalTabRef}
          type="button"
          role="tab"
          aria-selected={presentationMode === "terminal"}
          tabIndex={presentationMode === "terminal" ? 0 : -1}
          disabled={!supportsTerminal}
          onClick={() => selectMode("terminal")}
          className="relative h-full flex-1 flex justify-center items-center outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-full focus-visible:ring-2 focus-visible:ring-focus/50"
        >
          <span
            className={`relative z-10 flex w-full items-center justify-center gap-1.5 text-[11px] font-semibold tracking-tight transition-colors duration-200 ${
              activeText === "terminal" ? "text-foreground" : "text-muted/60"
            }`}
          >
            <TerminalSquare className="size-3" />
            CLI
          </span>
        </button>
      </div>
    </div>
  );
}
