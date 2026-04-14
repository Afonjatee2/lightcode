import { useId } from "react";
import type { StatusTone } from "./statusTone";

export function StatusIcon(props: {
  tone: StatusTone;
  path: string;
  viewBox: string;
  fillRule?: "evenodd" | "nonzero";
  cssPrefix: string;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const { tone, path, viewBox, fillRule, cssPrefix, className, title } = props;
  const baseId = useId().replaceAll(":", "");
  const clipId = `${baseId}-clip`;
  const gradientId = `${baseId}-gradient`;

  const [, , vbW, vbH] = viewBox.split(" ").map(Number);
  const viewBoxWidth = vbW ?? 16;
  const viewBoxHeight = vbH ?? 16;
  const scanWidth = viewBoxWidth * 2;
  const scanHeight = viewBoxHeight + 4;

  const pathProps = fillRule ? ({ clipRule: fillRule, fillRule } as const) : {};

  return (
    <span
      className={`lightcode-provider-icon lightcode-provider-icon--${tone} ${cssPrefix} ${cssPrefix}--${tone}${className ? ` ${className}` : ""}`}
    >
      <svg
        aria-hidden={title ? undefined : true}
        className="lightcode-provider-icon__svg"
        role={title ? "img" : undefined}
        viewBox={viewBox}
      >
        {title ? <title>{title}</title> : null}
        {tone === "working" ? (
          <defs>
            <clipPath id={clipId}>
              <path d={path} {...pathProps} />
            </clipPath>
            <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="40%" stopColor="white" stopOpacity="0" />
              <stop offset="52%" stopColor="white" stopOpacity="0.98" />
              <stop offset="64%" stopColor="white" stopOpacity="0" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
          </defs>
        ) : null}
        {tone === "working" ? (
          <path className="lightcode-provider-icon__shell" d={path} {...pathProps} />
        ) : null}
        <path
          className={`lightcode-provider-icon__fill${tone === "done" ? " opacity-40" : ""}`}
          d={path}
          {...pathProps}
        />
        {tone === "done" ? (
          <svg
            viewBox="0 0 24 24"
            x={viewBoxWidth * 0.15}
            y={viewBoxHeight * 0.15}
            width={viewBoxWidth * 0.7}
            height={viewBoxHeight * 0.7}
            className="text-success"
          >
            <path
              d="M5 13l4 4L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {tone === "working" ? (
          <rect
            className="lightcode-provider-icon__scan"
            clipPath={`url(#${clipId})`}
            fill={`url(#${gradientId})`}
            height={scanHeight}
            width={scanWidth}
            x={-scanWidth}
            y={-2}
          >
            <animate
              attributeName="x"
              dur="1.45s"
              from={-scanWidth}
              repeatCount="indefinite"
              to={viewBoxWidth}
            />
          </rect>
        ) : null}
      </svg>
    </span>
  );
}
