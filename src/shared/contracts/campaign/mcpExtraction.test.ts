import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { controlCentreCampaignContextSchema } from "./controlCentreCampaignContext";
import { controlCentreCampaignContextFixture } from "./fixtures/controlCentreCampaignContext.fixture";
import { mapCampaignContext } from "@/renderer/adapters/mapCampaignContext";

/**
 * Simulates `extractToolResultContent()` from
 * `src/supervisor/mcp/callMcpTool.ts` WITHOUT importing the real module
 * (which has Node-only dependencies — `@modelcontextprotocol/sdk` with
 *  `process.stdio` usage). The function is straightforward enough to
 *  replicate inline. This test proves the full pipeline end-to-end:
 *    MCP envelope → extractToolResultContent → wire schema parse → adapter → view model.
 */
function extractToolResultContent(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const textBlocks = result.content.filter(
    (block): block is Extract<CallToolResult["content"][number], { type: "text" }> =>
      block.type === "text",
  );
  if (textBlocks.length === 0) return undefined;
  const text = textBlocks.map((block) => block.text).join("\n");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildMCPCallToolResult(body: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(body, null, 2),
      },
    ],
  };
}

describe("MCP extraction pipeline (campaign context)", () => {
  it("extracts from a genuine CallToolResult envelope and maps to view model", () => {
    // 1. Build the MCP envelope (what CC's MCP server actually returns)
    const callToolResult = buildMCPCallToolResult(controlCentreCampaignContextFixture);

    // 2. Extract the raw body (the supervisor does this)
    const rawBody = extractToolResultContent(callToolResult);
    expect(rawBody).not.toBeUndefined();

    // 3. Parse against the exact wire schema
    const parsed = controlCentreCampaignContextSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);

    if (!parsed.success) return; // type narrowing

    // 4. Map through the adapter
    const vm = mapCampaignContext(parsed.data);

    // 5. Assert view-model correctness
    expect(vm.identity.campaignGroupId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(vm.identity.campaignName).toBe("Q4 Brand Refresh");
    expect(vm.identity.clientName).toBe("Bright Horizon Group");
    expect(vm.budget.currency).toBe("GBP");
    expect(vm.budget.spentToDate).toBe(68_250.5);
    expect(vm.budget.pctUsed).toBe(45.5);
    expect(vm.kpis).toHaveLength(3);
    expect(vm.openAlerts).toHaveLength(3);
    expect(vm.sourceHealth).toHaveLength(3);
    expect(vm.channels).toHaveLength(3);
    expect(vm.recentEvents).toHaveLength(3);
    expect(vm.activeDecisions).toHaveLength(1);
    expect(vm.pendingProposals).toHaveLength(2);
    expect(vm.evidenceFreshness).toBeDefined();
    expect(vm.suggestedQuestions).toHaveLength(4);
    expect(vm.generatedAt).toBeUndefined();
  });

  it("rejects a malformed payload at the wire schema layer", () => {
    const badBody = { identity: { name: "No ID", status: "live" } };
    const result = buildMCPCallToolResult(badBody);
    const raw = extractToolResultContent(result);
    expect(controlCentreCampaignContextSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects an MCP error envelope at the wire schema layer", () => {
    const errorResult: CallToolResult = {
      content: [{ type: "text", text: "Campaign group not found" }],
      isError: true,
    };
    const raw = extractToolResultContent(errorResult);
    // The text is a plain string, not a JSON object — should fail the schema
    expect(controlCentreCampaignContextSchema.safeParse(raw).success).toBe(false);
  });
});
