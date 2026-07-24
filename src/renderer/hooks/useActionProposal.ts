import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { adaptProposal } from "@/shared/campaignDeployment";
import type { ControlCentreProposal } from "@/shared/campaignDeployment";
import { useDeploymentClient } from "@/renderer/services/campaignDeployment";

export type ActionProposalState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; data: ControlCentreProposal };

const proposalSchema = z.unknown();

/**
 * Fetches a single action proposal through the deployment client (MCP-backed).
 * Refetches after approve/reject — never caches optimistic approval state.
 */
export function useActionProposal(options: {
  projectId: string | undefined;
  campaignGroupId: string | undefined;
  proposalId: string | null | undefined;
}): { state: ActionProposalState; refetch: () => Promise<void> } {
  const { projectId, campaignGroupId, proposalId } = options;
  const client = useDeploymentClient(projectId, campaignGroupId);
  const [state, setState] = useState<ActionProposalState>({ status: "loading" });
  const [refetchNonce, setRefetchNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    setRefetchNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!proposalId) {
      setState({ status: "empty" });
      return;
    }
    if (!client) {
      setState({
        status: "unavailable",
        message: "No Control Centre MCP server is configured for this project.",
      });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    client
      .getProposal(proposalId)
      .then((proposal) => {
        if (cancelled || !mounted.current) return;
        proposalSchema.parse(proposal);
        setState({ status: "ready", data: proposal });
      })
      .catch((error: unknown) => {
        if (cancelled || !mounted.current) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, proposalId, refetchNonce]);

  return { state, refetch };
}

/** Parses a raw MCP payload into a normalised proposal (for tests/adapters). */
export function parseProposalPayload(raw: unknown): ControlCentreProposal {
  return adaptProposal(raw);
}
