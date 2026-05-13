import { Tooltip } from "@heroui/react";
import type { ThreadContextUsageSummary } from "./threadContextUsage";

export function ThreadContextIndicator({
  summary,
  isOpen,
  onToggle,
}: {
  summary: ThreadContextUsageSummary;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = `${summary.headline}: ${summary.detail}`;
  const tone = resolveContextTone(summary.percent);
  const percent = summary.percent;
  const ringRadius = 6;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringProgress =
    percent === undefined ? 0 : Math.max(0, Math.min(1, percent / 100)) * ringCircumference;

  return (
    <Tooltip delay={150}>
      <Tooltip.Trigger>
        <button
          type="button"
          aria-label={isOpen ? "Hide context usage details" : "Show context usage details"}
          aria-pressed={isOpen}
          className={`lightcode-context-indicator ${isOpen ? "lightcode-context-indicator--open" : ""}`}
          data-tone={tone}
          onClick={onToggle}
        >
          <svg className="lightcode-context-indicator__ring" viewBox="0 0 16 16" aria-hidden="true">
            <circle
              className="lightcode-context-indicator__ring-track"
              cx="8"
              cy="8"
              r={ringRadius}
              fill="none"
              strokeWidth="1.75"
            />
            {percent !== undefined ? (
              <>
                <circle
                  className="lightcode-context-indicator__ring-progress"
                  cx="8"
                  cy="8"
                  r={ringRadius}
                  fill="none"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeDasharray={`${ringProgress} ${ringCircumference}`}
                  transform="rotate(-90 8 8)"
                />
                <text
                  className="lightcode-context-indicator__ring-number"
                  x="8"
                  y="8"
                  textAnchor="middle"
                  dominantBaseline="central"
                  alignmentBaseline="central"
                >
                  {percent}
                </text>
              </>
            ) : null}
          </svg>
          <span className="sr-only">{label}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top" className="px-1 py-1.5 text-xs">
        <div className="flex min-w-48 flex-col">
          <div className="px-2 pb-1.5 pt-0.5 font-semibold text-foreground">{summary.headline}</div>
          <div className="h-px w-full bg-[color:var(--border)]" />
          <div className="flex items-center justify-between gap-6 px-2 pb-0.5 pt-1.5 text-foreground-muted">
            <span>Used</span>
            <span className="font-medium text-foreground">{summary.usedLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-6 px-2 pb-1 pt-0.5 text-foreground-muted">
            <span>Limit</span>
            <span className="font-medium text-foreground">{summary.maxLabel}</span>
          </div>
          <span className="sr-only">{label}</span>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

function resolveContextTone(
  percent: number | undefined,
): "unknown" | "normal" | "warning" | "danger" {
  if (percent === undefined) return "unknown";
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "normal";
}
