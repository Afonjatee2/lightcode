import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { Globe, Users, type LucideIcon } from "lucide-react";
import type { ThreadConfig, ThreadPresentationMode } from "@/shared/contracts";
import { getBrowserMcpScope } from "./browserMcpScope";
import { getSubagentMcpScope } from "./subagentMcpScope";

/**
 * Registry of composer MCP toggles. Adding a third MCP server means appending
 * one descriptor here — the "+" add menu (`ComposerAddMenu`), the enabled chips
 * (`McpChip`), and the draft/active composers all iterate this list, so no new
 * per-MCP menu/chip code is needed.
 *
 * Labels/hints are lazy `msg` descriptors (module-level macros must use `msg`,
 * not `t`) resolved to strings at render time via `useLingui` — see the
 * settingsOptions.ts pattern.
 */

/** Per-thread gating for a composer MCP toggle; see `browserMcpScope.ts`. */
export type ComposerMcpScope = "none" | "launch" | "always";

/** `ThreadConfig` keys that hold the per-thread enable flag for each MCP. */
export type ComposerMcpConfigKey = "browserMcp" | "subagentMcp";

export interface ComposerMcpServerDescriptor {
  id: "browser" | "subagents";
  configKey: ComposerMcpConfigKey;
  icon: LucideIcon;
  /** Menu row + chip label. */
  label: MessageDescriptor;
  /** Chip tooltip / aria-label shown when the server is enabled on a thread. */
  enabledTitle: MessageDescriptor;
  /** aria-label for the chip's remove button. */
  disableLabel: MessageDescriptor;
  getScope: (agentKind: string, presentationMode: ThreadPresentationMode) => ComposerMcpScope;
}

export const browserMcpServer: ComposerMcpServerDescriptor = {
  id: "browser",
  configKey: "browserMcp",
  icon: Globe,
  label: msg`Browser`,
  enabledTitle: msg`Browser MCP enabled for this thread`,
  disableLabel: msg`Disable Browser MCP`,
  getScope: getBrowserMcpScope,
};

export const subagentMcpServer: ComposerMcpServerDescriptor = {
  id: "subagents",
  configKey: "subagentMcp",
  icon: Users,
  label: msg`Subagents`,
  enabledTitle: msg`Subagents enabled for this thread`,
  disableLabel: msg`Disable Subagents`,
  getScope: getSubagentMcpScope,
};

export const composerMcpServers: readonly ComposerMcpServerDescriptor[] = [
  browserMcpServer,
  subagentMcpServer,
];

/**
 * Build a `ThreadConfig` patch that flips one MCP toggle. Typed on the shared
 * config-key union so callers stay `exactOptionalPropertyTypes`-safe.
 */
export function mcpTogglePatch(
  configKey: ComposerMcpConfigKey,
  enabled: boolean,
): Partial<ThreadConfig> {
  const patch: Partial<Record<ComposerMcpConfigKey, boolean>> = { [configKey]: enabled };
  return patch;
}
