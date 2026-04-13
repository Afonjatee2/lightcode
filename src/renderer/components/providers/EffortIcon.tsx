import type { SVGProps } from "react";

/**
 * 4-bar signal icon using thin stroked lines. Active bars use `currentColor`,
 * inactive bars are drawn at low opacity so the full scale is always visible.
 *
 * Uses the effort's position within the available list so the icon scales
 * correctly regardless of which subset of levels a provider exposes.
 */
export function EffortIcon(
  props: SVGProps<SVGSVGElement> & { effort: string; efforts: readonly string[] },
) {
  const { effort, efforts, ...svgProps } = props;
  const index = efforts.indexOf(effort);
  const count = efforts.length;

  // Map index → 1..4 active bars, distributing evenly across the scale
  let active: number;
  if (count <= 1) {
    active = 4;
  } else {
    active = Math.min(4, Math.max(1, Math.round((index / (count - 1)) * 3) + 1));
  }

  // 4 vertical lines, left-to-right, increasing height
  // x positions spread across viewbox, bottom-aligned at y=20
  const bars = [
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
