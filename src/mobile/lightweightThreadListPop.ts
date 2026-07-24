import { getMobileRuntimePlatform, type MobileRuntimePlatform } from "./mobilePlatform";
import { isNativeApp } from "./pwaInstall";

export const LIGHTWEIGHT_THREAD_LIST_POP_CLASS = "m-shell--lightweight-thread-list-pop";
export const LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION = "m-lightweight-thread-list-pop";
export const LIGHTWEIGHT_SUBAGENT_PUSH_CLASS = "m-shell--lightweight-subagent-push";
export const LIGHTWEIGHT_SUBAGENT_PUSH_ANIMATION = "m-lightweight-subagent-push";
export const LIGHTWEIGHT_SUBAGENT_POP_CLASS = "m-shell--lightweight-subagent-pop";
export const LIGHTWEIGHT_SUBAGENT_POP_ANIMATION = "m-lightweight-subagent-pop";
export const LIGHTWEIGHT_THREAD_LIST_POP_DURATION_MS = 320;

interface MobileTransitionRuntime {
  readonly platform: MobileRuntimePlatform;
  readonly nativeApp: boolean;
}

/**
 * iOS Safari's View Transition capture can stall on a thread with a very tall
 * virtualized history. For that one pop, animate only the newly mounted list
 * shell; native Capacitor and other browsers keep the paired snapshot slide.
 */
export function shouldUseLightweightThreadListPop(
  fromPath: string | undefined,
  toPath: string,
  runtime: MobileTransitionRuntime = {
    platform: getMobileRuntimePlatform(),
    nativeApp: isNativeApp(),
  },
): boolean {
  return (
    runtime.platform === "ios" &&
    !runtime.nativeApp &&
    fromPath?.startsWith("/thread/") === true &&
    toPath === "/threads"
  );
}

/** Match a thread -> one of its routed subagents without decoding opaque ids. */
export function shouldUseLightweightSubAgentPush(
  fromPath: string | undefined,
  toPath: string,
  runtime: MobileTransitionRuntime = {
    platform: getMobileRuntimePlatform(),
    nativeApp: isNativeApp(),
  },
): boolean {
  if (runtime.platform !== "ios" || runtime.nativeApp || !fromPath) return false;
  const threadMatch = /^\/thread\/([^/]+)$/.exec(fromPath);
  const subAgentMatch = /^\/subagent\/([^/]+)\/[^/]+$/.exec(toPath);
  return threadMatch?.[1] !== undefined && threadMatch[1] === subAgentMatch?.[1];
}

/** Match a routed subagent returning to its already-mounted parent thread. */
export function shouldUseLightweightSubAgentPop(
  fromPath: string | undefined,
  toPath: string,
  runtime: MobileTransitionRuntime = {
    platform: getMobileRuntimePlatform(),
    nativeApp: isNativeApp(),
  },
): boolean {
  if (runtime.platform !== "ios" || runtime.nativeApp || !fromPath) return false;
  const subAgentMatch = /^\/subagent\/([^/]+)\/[^/]+$/.exec(fromPath);
  const threadMatch = /^\/thread\/([^/]+)$/.exec(toPath);
  return subAgentMatch?.[1] !== undefined && subAgentMatch[1] === threadMatch?.[1];
}
