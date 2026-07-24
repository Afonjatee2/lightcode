/** Compact personal command-centre wordmark used in the app chrome. */
export function BrandWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={className} aria-label="Tee's Cockpit">
      <span className="font-bold" aria-hidden="true">
        Tee's
      </span>
      <svg
        viewBox="0 0 24 100"
        aria-hidden="true"
        className="mx-[0.18em] inline-block h-[1em] w-[0.24em] overflow-visible align-baseline [fill:var(--accent)]"
      >
        <circle cx="12" cy="96" r="9" />
      </svg>
      <span className="font-semibold" aria-hidden="true">
        Cockpit
      </span>
    </span>
  );
}
