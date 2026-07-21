import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION,
  LIGHTWEIGHT_THREAD_LIST_POP_CLASS,
  LIGHTWEIGHT_THREAD_LIST_POP_DURATION_MS,
  shouldUseLightweightThreadListPop,
} from "./lightweightThreadListPop";

/**
 * Starts the iOS-web thread -> list fallback animation during the route commit,
 * before the new list shell is painted. The class targets only the lightweight
 * incoming chrome/list, never the outgoing virtualized transcript.
 */
export function useLightweightThreadListPop(
  shellRef: RefObject<HTMLDivElement | null>,
  pathname: string,
): void {
  const previousPathnameRef = useRef(pathname);

  useLayoutEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    const shell = shellRef.current;
    if (!shell) return;
    shell.classList.remove(LIGHTWEIGHT_THREAD_LIST_POP_CLASS);
    if (!shouldUseLightweightThreadListPop(previousPathname, pathname)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    shell.classList.add(LIGHTWEIGHT_THREAD_LIST_POP_CLASS);
    const removeClass = () => shell.classList.remove(LIGHTWEIGHT_THREAD_LIST_POP_CLASS);
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.animationName === LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION) removeClass();
    };
    shell.addEventListener("animationend", onAnimationEnd);
    const timeout = window.setTimeout(removeClass, LIGHTWEIGHT_THREAD_LIST_POP_DURATION_MS + 100);

    return () => {
      window.clearTimeout(timeout);
      shell.removeEventListener("animationend", onAnimationEnd);
      removeClass();
    };
  }, [pathname, shellRef]);
}
