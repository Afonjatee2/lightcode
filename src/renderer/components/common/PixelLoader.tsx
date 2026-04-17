import { useEffect, useRef, useState } from "react";

// 3×3 pixel grid:
// 0 1 2
// 3 4 5
// 6 7 8

type Frames = readonly (readonly number[])[];

const PATTERNS: Record<string, Frames> = {
  waveLR: [
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
  ],
  waveRL: [
    [2, 5, 8],
    [1, 4, 7],
    [0, 3, 6],
  ],
  waveTB: [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
  ],
  waveBT: [
    [6, 7, 8],
    [3, 4, 5],
    [0, 1, 2],
  ],
  diagTL: [[0], [1, 3], [2, 4, 6], [5, 7], [8]],
  diagBR: [[8], [5, 7], [2, 4, 6], [1, 3], [0]],
  diagTR: [[2], [1, 5], [0, 4, 8], [3, 7], [6]],
  diagBL: [[6], [3, 7], [0, 4, 8], [1, 5], [2]],
  orbit: [[0], [1], [2], [5], [8], [7], [6], [3]],
  snake: [[0], [1], [2], [5], [4], [3], [6], [7], [8]],
  spiral: [[0], [1], [2], [5], [8], [7], [6], [3], [4]],
  checker: [
    [0, 2, 4, 6, 8],
    [1, 3, 5, 7],
  ],
  breathe: [[4], [1, 3, 5, 7], [0, 2, 6, 8], [1, 3, 5, 7]],
  corners: [[0], [2], [8], [6]],
  lRotate: [
    [0, 3, 6, 7],
    [0, 1, 2, 5],
    [1, 2, 5, 8],
    [3, 6, 7, 8],
  ],
  pulse: [[4], [1, 3, 4, 5, 7], [0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 4, 5, 7]],
  scatter: [[0, 5], [2, 7], [1, 6], [4, 8], [3]],
};

const KEYS = Object.keys(PATTERNS);

const SIZES = { sm: 14, md: 20, lg: 32 } as const;

export interface PixelLoaderProps {
  size?: "sm" | "md" | "lg";
  color?: string;
  pattern?: keyof typeof PATTERNS;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}

let filterIdCounter = 0;

export function PixelLoader({
  size = "sm",
  color,
  pattern,
  speed = 160,
  className,
  style,
}: PixelLoaderProps) {
  const [frame, setFrame] = useState(0);
  const chosen = useRef(pattern ?? KEYS[Math.floor(Math.random() * KEYS.length)] ?? "waveLR");
  const filterId = useRef(`px-glow-${filterIdCounter++}`);
  const frames = PATTERNS[chosen.current] as Frames;

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), speed);
    return () => clearInterval(id);
  }, [frames.length, speed]);

  const s = SIZES[size];
  const gap = Math.round(s * 0.1);
  const cell = (s - gap * 2) / 3;
  const active = new Set(frames[frame]);
  const fill = color ?? "currentColor";
  const innerBlur = Math.max(1, cell * 0.5);
  const outerBlur = Math.max(2, cell * 1.2);

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      overflow="visible"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-label="Loading"
      role="img"
    >
      <defs>
        <filter id={filterId.current} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={outerBlur} result="outerBlur" />
          <feGaussianBlur in="SourceGraphic" stdDeviation={innerBlur} result="innerBlur" />
          <feMerge>
            <feMergeNode in="outerBlur" />
            <feMergeNode in="innerBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${filterId.current})`}>
        {Array.from({ length: 9 }, (_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const on = active.has(i);
          return (
            <rect
              key={i}
              x={col * (cell + gap)}
              y={row * (cell + gap)}
              width={cell}
              height={cell}
              fill={fill}
              opacity={on ? 1 : 0}
              style={{
                transition: on ? "opacity 60ms ease-in" : `opacity ${speed * 2}ms ease-out`,
              }}
            />
          );
        })}
      </g>
    </svg>
  );
}
