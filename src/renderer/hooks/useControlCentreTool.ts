import { useEffect, useRef, useState } from "react";
import { msg } from "@lingui/core/macro";
import type { z } from "zod";
import { i18n } from "@/renderer/i18n/i18n";
import {
  applyCampaignMcpProfile,
  CONTROL_CENTRE_MCP_SERVER_NAME,
  getCampaignMcpProfile,
  mergeMcpServers,
  type McpServer,
  type McpToolCallResult,
  type Project,
} from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { useProject } from "@/renderer/state/useThread";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

/**
 * Real, distinct states for a Control Centre MCP tool call — never just a
 * spinner-or-nothing. `empty` means the caller opted out (e.g. no campaign
 * linked to this project yet), not a failure.
 */
export type ControlCentreToolState<T> =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "unauthorized" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** Finds this project's Control Centre MCP server and applies its campaign profile. */
export function resolveControlCentreServer(
  project: Project | undefined,
  userMcpServers: readonly McpServer[],
): McpServer | undefined {
  if (!project) return undefined;
  const merged = mergeMcpServers(userMcpServers, project.mcpServers ?? []);
  const server = merged.find(
    (candidate) =>
      candidate.enabled && candidate.name.trim().toLowerCase() === CONTROL_CENTRE_MCP_SERVER_NAME,
  );
  if (!server) return undefined;
  return applyCampaignMcpProfile([server], getCampaignMcpProfile(project))[0];
}

function stateFromResult<T>(
  result: McpToolCallResult,
  schema: z.ZodType<T>,
  toolName: string,
): ControlCentreToolState<T> {
  if (result.status === "auth-required") return { status: "unauthorized" };
  if (result.status === "unavailable") {
    return { status: "unavailable", message: result.error.message };
  }
  if (result.status === "tool-error") return { status: "error", message: result.message };
  // If content is a raw string, JSON.parse failed in extractToolResultContent —
  // the response was too large or malformed, not a schema mismatch.
  if (typeof result.content === "string") {
    if (import.meta.env.DEV) {
      console.log(
        `[cc-tool] JSON parse failed on "${toolName}": response was ${result.content.length} chars`,
      );
    }
    return {
      status: "error",
      message: i18n._(
        msg`Control Centre "${toolName}" returned a response that was too large or malformed. Try refreshing.`,
      ),
    };
  }
  const parsed = schema.safeParse(result.content);
  if (!parsed.success) {
    // Dev-only diagnostics — log issue paths/codes, never raw values
    if (import.meta.env.DEV) {
      console.log(
        `[cc-tool] schema mismatch on "${toolName}":`,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    return {
      status: "error",
      message: i18n._(
        msg`Control Centre "${toolName}" returned a response this version of Tee's Cockpit doesn't understand.`,
      ),
    };
  }
  return { status: "ready", data: parsed.data };
}

/**
 * Calls a single Control Centre MCP tool for the given project's bound
 * Control Centre server, through the same renderer → supervisor IPC bridge
 * used by `useMcpServerProbes` (`readBridge().probeMcpServer`) — here via
 * the generic `callMcpTool` procedure instead of a discovery-only probe.
 *
 * Re-fetches are keyed off a content fingerprint (mirroring
 * `useMcpServerProbes`'s `JSON.stringify` fingerprinting) rather than the
 * raw `args`/`server` object identity — callers routinely pass a fresh
 * `{ id: ... }` literal on every render, and keying off identity there
 * would re-fire the effect (and re-`setState`) every render forever.
 */
export function useControlCentreTool<T>(options: {
  projectId: string | undefined;
  toolName: string;
  args: unknown;
  schema: z.ZodType<T>;
  /** Skip the call and report `{ status: "empty" }` — e.g. no campaign linked yet. */
  skip: boolean;
}): { state: ControlCentreToolState<T>; refetch: () => void } {
  const { projectId, toolName, args, schema, skip } = options;
  const project = useProject(projectId);
  const userMcpServers = useSharedSettings((s) => s.mcpServers);
  const [state, setState] = useState<ControlCentreToolState<T>>({ status: "loading" });
  const [refetchNonce, setRefetchNonce] = useState(0);
  const requestSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const server = skip ? undefined : resolveControlCentreServer(project, userMcpServers);
  const requestKey = JSON.stringify({
    skip,
    server: server ?? null,
    projectLocation: project?.location ?? null,
    toolName,
    args: args ?? null,
  });

  useEffect(() => {
    if (skip) {
      setState({ status: "empty" });
      return;
    }
    if (!server) {
      setState({
        status: "unavailable",
        message: i18n._(msg`No Control Centre MCP server is configured for this project.`),
      });
      return;
    }

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setState({ status: "loading" });

    readBridge()
      .callMcpTool({
        server,
        ...(project?.location ? { projectLocation: project.location } : {}),
        toolName,
        args,
      })
      .then((result) => {
        if (!mounted.current || requestSequence.current !== sequence) return;
        setState(stateFromResult(result, schema, toolName));
      })
      .catch(() => {
        if (!mounted.current || requestSequence.current !== sequence) return;
        setState({
          status: "unavailable",
          message: i18n._(msg`Could not reach the MCP runtime.`),
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey is a content fingerprint of every value this effect reads (skip/server/projectLocation/toolName/args); keying on the raw values would re-fire on every render since callers routinely pass fresh object literals.
  }, [requestKey, refetchNonce]);

  return { state, refetch: () => setRefetchNonce((n) => n + 1) };
}
