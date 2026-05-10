import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { AgentSlashCommand } from "@/shared/contracts";

interface ThreadCommandPanelProps {
  commands: AgentSlashCommand[];
  activeIndex: number;
  onSelect: (command: AgentSlashCommand) => void;
  onActiveIndexChange: (index: number) => void;
}

export function ThreadCommandPanel(props: ThreadCommandPanelProps) {
  const { commands, activeIndex, onSelect } = props;
  const activeRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof activeRowRef.current?.scrollIntoView === "function") {
      activeRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (commands.length === 0) return null;

  return (
    <section
      aria-label="Slash commands"
      className="flex flex-col border-b border-[color:var(--border)] bg-transparent text-xs"
    >
      <div className="flex items-center gap-2 px-2 py-1 leading-none">
        <Terminal className="size-3.5 shrink-0 text-foreground-muted" />
        <div className="flex min-w-0 flex-1 items-center gap-2 leading-none">
          <span className="font-semibold text-foreground">Commands</span>
          <span className="text-[0.85em] text-[color:var(--muted)]">{commands.length}</span>
        </div>
      </div>

      <div className="px-1 pb-1">
        <ul
          className="max-h-[min(12rem,32vh)] space-y-0 overflow-y-auto [scrollbar-gutter:stable]"
          role="listbox"
        >
          {commands.map((cmd, index) => {
            const isActive = index === activeIndex;
            return (
              <li
                key={cmd.id}
                role="presentation"
                onMouseEnter={() => props.onActiveIndexChange(index)}
              >
                <button
                  ref={isActive ? activeRowRef : undefined}
                  aria-selected={isActive}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left leading-5 transition-colors hover:bg-foreground/5 ${
                    isActive ? "bg-accent/10" : ""
                  }`}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(cmd)}
                >
                  <span className="font-medium text-foreground">/{cmd.id}</span>
                  {cmd.description && (
                    <span className="min-w-0 flex-1 truncate text-foreground-muted">
                      {cmd.description}
                    </span>
                  )}
                  {cmd.argumentHint && (
                    <span className="shrink-0 text-muted/60">{cmd.argumentHint}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
