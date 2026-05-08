import type { PermissionRule } from "@opencode-ai/sdk/v2";

/**
 * Map our `approvalPolicy` config to OpenCode's `PermissionRuleset`.
 *
 * Mirrors t3code's `buildOpenCodePermissionRules` (apps/server/src/provider/
 * opencodeRuntime.ts:209-225). Question prompts are auto-allowed in both
 * modes — they're informational, not gating.
 */
export function buildOpenCodePermissionRules(approvalPolicy: string | undefined): PermissionRule[] {
  const isFullAccess = approvalPolicy === "yolo" || approvalPolicy === "never";
  if (isFullAccess) {
    return [{ permission: "*", pattern: "*", action: "allow" }];
  }

  return [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "webfetch", pattern: "*", action: "ask" },
    { permission: "websearch", pattern: "*", action: "ask" },
    { permission: "codesearch", pattern: "*", action: "ask" },
    { permission: "external_directory", pattern: "*", action: "ask" },
    { permission: "doom_loop", pattern: "*", action: "ask" },
    { permission: "question", pattern: "*", action: "allow" },
  ];
}
