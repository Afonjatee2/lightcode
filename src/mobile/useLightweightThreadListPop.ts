import { useLayoutEffect, useRef, type RefObject } from "react";
import {
  LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION,
  LIGHTWEIGHT_THREAD_LIST_POP_CLASS,
  LIGHTWEIGHT_THREAD_LIST_POP_DURATION_MS,
  LIGHTWEIGHT_SUBAGENT_PUSH_ANIMATION,
  LIGHTWEIGHT_SUBAGENT_PUSH_CLASS,
  LIGHTWEIGHT_SUBAGENT_POP_ANIMATION,
  LIGHTWEIGHT_SUBAGENT_POP_CLASS,
  shouldUseLightweightSubAgentPop,
  shouldUseLightweightSubAgentPush,
  shouldUseLightweightThreadListPop,
} from "./lightweightThreadListPop";

/**
 * Starts iOS-web fallback animations during the route commit, before the new
 * route paints. Both supported paths target only lightweight incoming layers,
 * never a virtualized transcript snapshot.
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
    shell.classList.remove(LIGHTWEIGHT_SUBAGENT_PUSH_CLASS);
    shell.classList.remove(LIGHTWEIGHT_SUBAGENT_POP_CLASS);
    const threadListPop = shouldUseLightweightThreadListPop(previousPathname, pathname);
    const subAgentPush = shouldUseLightweightSubAgentPush(previousPathname, pathname);
    const subAgentPop = shouldUseLightweightSubAgentPop(previousPathname, pathname);
    if (!threadListPop && !subAgentPush && !subAgentPop) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const animationClass = subAgentPush
      ? LIGHTWEIGHT_SUBAGENT_PUSH_CLASS
      : subAgentPop
        ? LIGHTWEIGHT_SUBAGENT_POP_CLASS
        : LIGHTWEIGHT_THREAD_LIST_POP_CLASS;
    const animationName = subAgentPush
      ? LIGHTWEIGHT_SUBAGENT_PUSH_ANIMATION
      : subAgentPop
        ? LIGHTWEIGHT_SUBAGENT_POP_ANIMATION
        : LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION;
    shell.classList.add(animationClass);
    const removeClass = () => shell.classList.remove(animationClass);
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.animationName === animationName) removeClass();
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
