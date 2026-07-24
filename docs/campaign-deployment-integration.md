# Campaign Deployment Profile — Poracode Integration Boundary

## Overview

The Campaign Deployment Profile bridges Poracode's campaign workspace with
Control Centre's action proposal system. Poracode provides the operator UI
and policy enforcement; Control Centre owns the server-side lifecycle,
approval state machine, risk classification, and platform execution.

**Poracode never writes directly to advertising platforms.** Every
platform change goes through a `create` → `submit` → `approve` → `apply`
workflow managed entirely by Control Centre.

## Architecture

```
┌─────────────────────────────────┐       ┌──────────────────────────┐
│  Poracode CampaignWorkspace UI  │       │  Control Centre API/MCP  │
│                                 │       │                          │
│  useDeploymentClient() ─────────┼─GET ──▶  /action-proposals/:id   │
│                                 │  POST   /action-proposals/:id/   │
│  profilePolicy.ts ── gate ──────┤         approve|reject           │
│                                 │       │                          │
│  (NO apply/write path)          │       │  proposal-state-machine  │
│                                 │       │  risk-classification     │
│                                 │       │  platform connector      │
└─────────────────────────────────┘       └──────────────────────────┘
```

## Module Layout

```
src/shared/campaignDeployment/
  types.ts                        — Zod schemas + TS types
  controlCentreAdapter.ts         — Normalises server responses
  controlCentreClient.ts          — Injectable HTTP/fixture client
  profilePolicy.ts                — Pure allow/deny policy
  index.ts                        — Barrel export
  *.test.ts                       — Co-located tests

src/renderer/services/campaignDeployment/
  useDeploymentClient.ts          — React hook (integration point)
  index.ts                        — Barrel export

docs/
  campaign-deployment-integration.md  — This file
```

## Key Types

### `ControlCentreProposal`

The normalised proposal shape used throughout Poracode. Fields:

- **Status lifecycle**: `draft` → `awaiting_approval` → `approved|rejected` → `applying` → `applied|failed`
- **State tracking**: `beforeState`, `expectedAfterState`, `appliedAfterState`
- **Risk**: `riskLevel`, `riskReasons`, `requiresStrongConfirmation`
- **Audit**: `approvalNote`, `rejectionReason`, timestamps, `platformResponse`, `rollbackGuidance`

### `ControlCentreDeploymentClient`

Interface with 5 operations:

- `listProposals(filter)` — list with optional status filter
- `getProposal(id)` — single proposal detail
- `refreshProposal(id)` — re-fetch server-updated status
- `approveProposal(payload)` — approve with optional note + strong confirmation
- `rejectProposal(payload)` — reject with optional reason

**Deliberately absent**: `applyProposal`, `executeProposal`, any platform-write.

## Responsiveness Adaptation

The adapter (`controlCentreAdapter.ts`) tolerates the dirty Phase 6 contract:

- Maps `snake_case` ←→ `camelCase` field variants
- Handles response envelopes: `data`, `proposals`, `rows`, `items`, `results`
- Coerces missing/incorrectly-typed fields to safe defaults
- Does NOT recompute evidence, create a second lifecycle, or write to any DB

## Policy

`profilePolicy.ts` implements:

- **Allow**: read/list/get, proposal creation, approve/reject
- **Deny**: all direct platform-write patterns (`apply_*`, `meta_ads.*`, `campaign.create`, etc.)
- **Deny-by-default**: unknown tools matching write heuristics are blocked
- **Defer**: unknown non-write tools are passed to MCP server for final decision
- Policy is pure and testable — no network, no DB, no side effects

## Integration Hooks

### Profile Registration (protected — documented only)

The existing profile system is owned by another swarm. To activate the
Deployment profile in a campaign project, set:

```ts
project.campaignExtension.mcpProfileId = "deployment";
```

The profile configuration lives in Control Centre's `apps/mcp/src/profiles.ts`
under the `deployment` key.

### CampaignWorkspace UI (protected — documented only)

Wire the deployment client into CampaignWorkspace by importing
`useDeploymentClient`:

```tsx
import { useDeploymentClient } from "@/renderer/services/campaignDeployment/useDeploymentClient";

function ProposalPanel({ campaignGroupId }: { campaignGroupId: string }) {
  const client = useDeploymentClient(campaignGroupId);
  // use client.listProposals, .approveProposal, .rejectProposal
}
```

## Fixtures

`FixtureDeploymentClient` provides an in-memory client for tests and
development. All fixtures are explicitly non-production — no real campaign
data, live plan, platform credentials, or tokens are touched.

## Testing

```bash
pnpm test -- src/shared/campaignDeployment/
```

Test coverage:

- Response validation/mapping (snake_case, camelCase, envelopes, defaults)
- Endpoint calls (list, get, refresh, approve, reject)
- High-risk confirmation forwarding
- Rejection reasons forwarding
- Server status refresh
- No direct platform-write path (compile-time + runtime)
- Profile allow/deny policy
- Denied-patterns-win-over-allowed
- Unknown-write heuristic detection

## Assumptions

1. Control Centre API routes under `/campaign-groups/:id/action-proposals` and
   `/action-proposals/:id` exist and may be partially implemented.
2. `applied`/`applying`/`failed` status transitions happen exclusively on the
   Control Centre server; Poracode observes via `refreshProposal`.
3. The `deployment` MCP profile exists in Control Centre's profile registry.
4. No second approval system: this is the sole approval path Poracode uses.
5. No direct platform write: the client has no apply/execute/write methods.
