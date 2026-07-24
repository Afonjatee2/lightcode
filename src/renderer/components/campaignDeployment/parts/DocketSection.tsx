import type { ReactNode } from "react";

/**
 * Numbered docket section: a hairline rule, a two-digit index, and a small
 * caps heading — the editorial "decision docket" idiom used across the
 * approval surface instead of a card grid.
 */
export function DocketSection(props: {
  index: string;
  heading: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      aria-label={props.heading}
      className="border-t border-divider pt-4"
      data-testid={`docket-section-${props.index}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-tiny font-semibold uppercase tracking-widest text-default-500">
          <span className="font-mono text-default-400">{props.index}</span>
          {props.heading}
        </h2>
        {props.aside}
      </div>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}
