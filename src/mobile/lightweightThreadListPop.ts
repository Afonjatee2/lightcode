import { getMobileRuntimePlatform, type MobileRuntimePlatform } from "./mobilePlatform";
import { isNativeApp } from "./pwaInstall";

export const LIGHTWEIGHT_THREAD_LIST_POP_CLASS = "m-shell--lightweight-thread-list-pop";
export const LIGHTWEIGHT_THREAD_LIST_POP_ANIMATION = "m-lightweight-thread-list-pop";
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
