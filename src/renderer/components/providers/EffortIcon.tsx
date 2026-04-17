import type { SVGProps } from "react";

/**
 * Signal-bar icon using thin stroked lines. Active bars use `currentColor`,
 * inactive bars are drawn at low opacity so the full scale is always visible.
 *
 * Renders 4 or 5 bars depending on how many effort levels the provider
 * exposes. The effort's position within the list determines how many bars
 * are lit.
 */
export function EffortIcon(
  props: SVGProps<SVGSVGElement> & { effort: string; efforts: readonly string[] },
) {
  const { effort, efforts, ...svgProps } = props;
  const index = efforts.indexOf(effort);
  const count = efforts.length;
  const totalBars = count >= 5 ? 5 : 4;

  let active: number;
  if (count <= 1) {
    active = totalBars;
  } else {
    active = Math.min(
      totalBars,
      Math.max(1, Math.round((index / (count - 1)) * (totalBars - 1)) + 1),
    );
  }

  const bars =
    totalBars === 5
      ? [
          { x: 3.5, y1: 20, y2: 17 },
          { x: 7.25, y1: 20, y2: 14 },
          { x: 11, y1: 20, y2: 10 },
          { x: 14.75, y1: 20, y2: 6 },
          { x: 18.5, y1: 20, y2: 3 },
        ]
      : [
          { x: 5, y1: 20, y2: 16 },
          { x: 9.5, y1: 20, y2: 12 },
          { x: 14, y1: 20, y2: 8 },
          { x: 18.5, y1: 20, y2: 4 },
        ];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      {...svgProps}
    >
      {bars.map((bar, i) => (
        <line
          key={i}
          x1={bar.x}
          y1={bar.y1}
          x2={bar.x}
          y2={bar.y2}
          opacity={i < active ? 1 : 0.2}
        />
      ))}
    </svg>
  );
}
