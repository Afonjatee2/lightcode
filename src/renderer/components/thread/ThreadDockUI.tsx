import { forwardRef, type ReactNode } from "react";

export function ThreadDockSection({
  children,
  placement = "composer",
  collapsed = false,
  className = "",
  ariaLabel = "Thread dock",
}: {
  children: ReactNode;
  placement?: "composer" | "right";
  collapsed?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const baseClass =
    placement === "composer"
      ? "flex flex-col border-b border-[color:var(--border)] bg-transparent text-xs"
      : collapsed
        ? "flex flex-col rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] text-xs"
        : "flex h-full min-h-0 flex-col rounded-2xl border border-[color:var(--border)] bg-[var(--composer-surface)] text-xs";

  return (
    <section
      aria-label={ariaLabel}
      className={`${baseClass} ${className}`}
      data-collapsed={collapsed ? "true" : "false"}
      data-placement={placement}
    >
      {children}
    </section>
  );
}

export function ThreadDockHeader({
  icon: Icon,
  iconClassName = "text-foreground-muted",
  title,
  countLabel,
  actions,
  children,
}: {
  icon: React.ElementType<{ className?: string }>;
  iconClassName?: string;
  title: string;
  countLabel?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 leading-none">
      <Icon className={`size-3.5 shrink-0 ${iconClassName}`} />
      <div className="flex min-w-0 flex-1 items-center gap-2 leading-none">
        <span className="font-semibold text-foreground">{title}</span>
        {countLabel && (
          <span className="flex items-center gap-1 text-[0.85em] text-[color:var(--muted)]">
            {countLabel}
          </span>
        )}
        {children}
      </div>
      {actions}
    </div>
  );
}

export function ThreadDockList({
  children,
  placement = "composer",
  collapsed = false,
}: {
  children: ReactNode;
  placement?: "composer" | "right";
  collapsed?: boolean;
}) {
  return (
    <div className={placement === "right" && !collapsed ? "min-h-0 flex-1 px-1 pb-1" : "px-1 pb-1"}>
      <ul
        className={
          collapsed
            ? "space-y-0"
            : placement === "composer"
              ? "max-h-[min(12rem,32vh)] space-y-0 overflow-y-auto [scrollbar-gutter:stable]"
              : "min-h-0 h-full space-y-0 overflow-y-auto [scrollbar-gutter:stable]"
        }
        role="list"
      >
        {children}
      </ul>
    </div>
  );
}

export const ThreadDockRow = forwardRef<
  HTMLLIElement,
  {
    children: ReactNode;
    isActive?: boolean;
    isDone?: boolean;
    title?: string;
    onClick?: () => void;
  }
>(function ThreadDockRow({ children, isActive, isDone, title, onClick }, ref) {
  const innerClass = `flex items-center gap-2 rounded px-2 py-1 leading-5 ${
    isDone ? "opacity-60" : ""
  } ${isActive && !isDone ? "bg-accent/10" : ""}`;

  if (onClick) {
    return (
      <li ref={ref} className="flex" role="listitem">
        <button
          type="button"
          onClick={onClick}
          className={`group flex min-w-0 flex-1 text-left transition-colors hover:bg-foreground/5 ${innerClass}`}
          aria-label={title}
          title={title}
        >
          {children}
        </button>
      </li>
    );
  }

  return (
    <li
      ref={ref}
      className={innerClass}
      role="listitem"
      title={title}
      aria-current={isActive ? "step" : undefined}
    >
      {children}
    </li>
  );
});
