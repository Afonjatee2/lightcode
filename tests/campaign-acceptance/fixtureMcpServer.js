#!/usr/bin/env node
/**
 * @file Fixture MCP server for Phase 3 campaign workspace acceptance tests.
 * Self-contained JS file (no compilation needed) that implements a real MCP
 * server responding to Control Centre tools with fixture data.
 *
 * Usage:
 *   CONTROL_CENTRE_MCP_PROFILE=monitoring node tests/campaign-acceptance/fixtureMcpServer.js
 *
 * Supported profiles: monitoring, unauthorized, empty-campaign, malformed,
 * slow, tool-error, zero-budget, null-values
 *
 * REMOVAL: Phase 3 acceptance-only tool. Remove when shared Phase 4
 * persistence migration is integrated.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// ============================================================================
// Fixture data (inlined to keep this a standalone JS file)
// ============================================================================

const OPERATIONS_TODAY = {
  generatedAt: new Date().toISOString(),
  needsAttention: [
    {
      campaignGroupId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Q4 Brand Refresh",
      clientName: "Acme Corp",
      status: "active",
      deliveryState: "delivering",
      openAlerts: 3,
      pendingProposals: 2,
      sourceHealthSummary: { healthy: 1, stale: 1, failed: 1 },
      lastDataFreshnessAt: new Date(Date.now() - 3600000).toISOString(),
      topPriority: "P1",
      attentionReason: "3 open alerts, highest priority P1",
    },
    {
      campaignGroupId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      name: "Always-On Search",
      clientName: null,
      status: "active",
      deliveryState: "stale",
      openAlerts: 1,
      pendingProposals: 0,
      sourceHealthSummary: { healthy: 0, stale: 2, failed: 0 },
      lastDataFreshnessAt: null,
      topPriority: "P3",
      attentionReason: "1 open alert, highest priority P3",
    },
  ],
  waitingForApproval: [
    {
      campaignGroupId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      name: "Holiday Gifting Campaign",
      clientName: "Maple & Pine Co.",
      status: "active",
      deliveryState: "delivering",
      openAlerts: 0,
      pendingProposals: 3,
      sourceHealthSummary: { healthy: 3, stale: 0, failed: 0 },
      lastDataFreshnessAt: new Date(Date.now() - 7200000).toISOString(),
      attentionReason: "3 proposals awaiting approval",
    },
  ],
  otherLive: [
    {
      campaignGroupId: "d4e5f6a7-b8c9-0123-defa-234567890123",
      name: "B2B Lead Gen",
      clientName: "Orion Technical Solutions",
      status: "active",
      deliveryState: "delivering",
      openAlerts: 0,
      pendingProposals: 0,
      sourceHealthSummary: { healthy: 2, stale: 0, failed: 0 },
      lastDataFreshnessAt: new Date(Date.now() - 10800000).toISOString(),
    },
    {
      campaignGroupId: "e5f6a7b8-c9d0-1234-efab-345678901234",
      name: "Q1 Teaser Campaign",
      clientName: "Bright Horizon Group",
      status: "active",
      deliveryState: "unavailable",
      openAlerts: 0,
      pendingProposals: 0,
      sourceHealthSummary: { healthy: 0, stale: 0, failed: 0 },
      lastDataFreshnessAt: null,
    },
  ],
  healthyCampaignCount: 2,
  sourceHealthSummary: { healthy: 6, stale: 3, failed: 1 },
  recentlyResolved: [
    {
      campaignGroupId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name: "Q4 Brand Refresh",
      alertId: "alert-resolved-1",
      resolvedAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
};

const CAMPAIGN_CONTEXT = {
  identity: {
    id: "group-f3d2d0d9-97c4-4ace-8b68-960d4b27470b",
    name: "Q4 Brand Refresh",
    clientName: "Acme Corp",
    jobNumber: "ACME-2026-Q4-01",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    status: "live",
  },
  budget: {
    totalBudget: 150000,
    spentToDate: 68250.5,
    remaining: 81749.5,
    percentUsed: 0.455,
    expectedPercentUsed: 0.42,
    pacingStatus: "AHEAD",
  },
  kpiTargets: [
    {
      id: "kpi-1",
      metricKey: "ctr",
      targetType: "min",
      targetValue: 2.0,
      actualValue: 1.85,
      percentAchieved: 0.925,
      status: "on_track",
    },
    {
      id: "kpi-2",
      metricKey: "cpa",
      targetType: "max",
      targetValue: 35.0,
      actualValue: 42.3,
      percentAchieved: 0.827,
      status: "off_track",
    },
    {
      id: "kpi-3",
      metricKey: "reach",
      targetType: "min",
      targetValue: 500000,
      actualValue: null,
      percentAchieved: null,
      status: null,
    },
  ],
  openAlerts: [
    {
      id: "alert-1",
      title: "Overspend on Meta channel",
      severity: "critical",
      priority: "P1",
      openedAt: new Date(Date.now() - 172800000).toISOString(),
    },
    {
      id: "alert-2",
      title: "LinkedIn CPA trending up",
      severity: "warning",
      priority: "P2",
      openedAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "alert-3",
      title: "GA4 connector delayed sync",
      severity: "info",
      priority: "P4",
      openedAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  channelExecutions: [
    {
      id: "ch-1",
      channelLabel: "Meta Ads",
      platform: "facebook",
      plannedBudget: 60000,
      actualSpend: 42100,
      status: "active",
    },
    {
      id: "ch-2",
      channelLabel: "LinkedIn Sponsored",
      platform: "linkedin",
      plannedBudget: 40000,
      actualSpend: 18650.5,
      status: "active",
    },
    {
      id: "ch-3",
      channelLabel: "Programmatic Display",
      platform: "dv360",
      plannedBudget: 50000,
      actualSpend: 7500,
      status: "paused",
    },
  ],
  sourceHealth: [
    {
      sourceAccountId: "src-1",
      sourceName: "Meta Business Account",
      status: "healthy",
      lastSuccessfulSyncAt: new Date().toISOString(),
      reason: null,
    },
    {
      sourceAccountId: "src-2",
      sourceName: "LinkedIn Campaign Manager",
      status: "stale",
      lastSuccessfulSyncAt: new Date(Date.now() - 86400000).toISOString(),
      reason: "Rate-limited by platform API",
    },
    {
      sourceAccountId: "src-3",
      sourceName: "DV360 Connector",
      status: "failed",
      lastSuccessfulSyncAt: null,
      reason: "OAuth token expired",
    },
  ],
  activeDecisions: [
    {
      id: "dec-1",
      title: "Shift budget from Meta to LinkedIn for December",
      decisionType: "budget_reallocation",
      status: "draft",
      createdAt: new Date(Date.now() - 172800000).toISOString(),
    },
  ],
  recentEvents: [
    {
      id: "evt-1",
      eventType: "plan_published",
      title: "Q4 Brand Refresh plan published",
      description: "Media plan approved by client and pushed to channels.",
      severity: "info",
      createdAt: new Date(Date.now() - 604800000).toISOString(),
    },
    {
      id: "evt-2",
      eventType: "alert_opened",
      title: "Overspend on Meta channel",
      description: null,
      severity: "critical",
      createdAt: new Date(Date.now() - 172800000).toISOString(),
    },
    {
      id: "evt-3",
      eventType: "operator_note",
      title: "Client requested spend review",
      description:
        "Client wants a mid-month breakdown of Meta spend by ad set before approving December reallocation.",
      severity: "info",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
  pendingProposals: [
    {
      id: "prop-1",
      title: "December budget reallocation plan",
      status: "pending_review",
      riskLevel: "low",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "prop-2",
      title: "Add TikTok as Q1 test channel",
      status: "draft",
      riskLevel: null,
      createdAt: new Date(Date.now() - 172800000).toISOString(),
    },
  ],
  evidence: [
    {
      claimKey: "spend_vs_budget",
      statement:
        "Total channel spend is 45.5% of budget against 42.0% of elapsed campaign days, pacing ahead.",
      calculation: {
        expression: "spentToDate / totalBudget",
        inputs: { spentToDate: 68250.5, totalBudget: 150000 },
        result: 0.455,
      },
      sources: [
        {
          sourceType: "campaign_group",
          sourceId: "group-f3d2d0d9-97c4-4ace-8b68-960d4b27470b",
          label: "Campaign group budget row",
          capturedAt: new Date().toISOString(),
          freshnessStatus: "fresh",
        },
      ],
    },
  ],
  suggestedQuestions: [
    "Why is Q4 Brand Refresh overspending, and where can we pull back?",
    "What are the 3 open alerts on Q4 Brand Refresh?",
    "Why is cpa off track?",
    "Summarise how Q4 Brand Refresh is performing this week.",
  ],
};

const ZERO_BUDGET_CAMPAIGN = {
  ...JSON.parse(JSON.stringify(CAMPAIGN_CONTEXT)),
  budget: {
    totalBudget: 0,
    spentToDate: 0,
    remaining: 0,
    percentUsed: null,
    expectedPercentUsed: null,
    pacingStatus: null,
  },
};

const NULL_VALUES_CAMPAIGN = {
  identity: {
    id: "null-campaign",
    name: "Null Campaign",
    clientName: null,
    jobNumber: null,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "live",
  },
  budget: {
    totalBudget: null,
    spentToDate: 0,
    remaining: null,
    percentUsed: null,
    expectedPercentUsed: null,
    pacingStatus: null,
  },
  kpiTargets: [],
  openAlerts: [],
  channelExecutions: [],
  sourceHealth: [],
  activeDecisions: [],
  recentEvents: [],
  pendingProposals: [],
  evidence: [],
  suggestedQuestions: [],
};

const EMPTY_CAMPAIGN = {
  identity: {
    id: "empty-campaign",
    name: "Empty Campaign",
    clientName: "No Data Client",
    jobNumber: null,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "planning",
  },
  budget: {
    totalBudget: null,
    spentToDate: 0,
    remaining: null,
    percentUsed: null,
    expectedPercentUsed: null,
    pacingStatus: null,
  },
  kpiTargets: [],
  openAlerts: [],
  channelExecutions: [],
  sourceHealth: [],
  activeDecisions: [],
  recentEvents: [],
  pendingProposals: [],
  evidence: [],
  suggestedQuestions: [],
};

const profile = process.env.CONTROL_CENTRE_MCP_PROFILE || "monitoring";

// ============================================================================
// MCP Server
// ============================================================================

const server = new Server(
  { name: "campaign-acceptance-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_operations_today",
      description: "Get today's campaign operations overview (acceptance fixture)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_campaign_context",
      description: "Get full context for one campaign group (acceptance fixture)",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Campaign group ID" } },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: _args } = request.params;

  if (profile === "slow") {
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (profile === "unauthorized") {
    throw Object.assign(new Error("Not authorized"), {
      code: -32001,
      data: { authRequired: true, scheme: "oauth" },
    });
  }

  if (profile === "malformed" && name === "get_campaign_context") {
    return {
      content: [{ type: "text", text: JSON.stringify({ broken: true, fields: null }) }],
    };
  }

  if (profile === "tool-error") {
    return {
      isError: true,
      content: [{ type: "text", text: "The requested data is currently unavailable." }],
    };
  }

  if (name === "get_operations_today") {
    return { content: [{ type: "text", text: JSON.stringify(OPERATIONS_TODAY) }] };
  }

  if (name === "get_campaign_context") {
    let data = CAMPAIGN_CONTEXT;
    if (profile === "zero-budget") data = ZERO_BUDGET_CAMPAIGN;
    if (profile === "null-values") data = NULL_VALUES_CAMPAIGN;
    if (profile === "empty-campaign") data = EMPTY_CAMPAIGN;
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ============================================================================
// Start
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[fixture-mcp-server] ready profile=${profile}\n`);
