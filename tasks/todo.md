# Todo Plan: Fix Provider Unavailable Error for Consultations

## Phase 1: Investigation & Proof of Root Cause

- [x] Trace provider catalog resolution: `CampaignAgentProviderCatalog.list()` -> `CampaignAgentRegistry.resolveAll()` -> `getCapabilities(kind)` & `getSpawnableAgents()`.
- [x] Confirm cold capabilities cache behavior: `AgentStatusService.getCachedCapabilities(kind)` returns `undefined` when disk cache is unpopulated (`fromCache: false`), causing `resolveAll()` to silently drop all agents.
- [x] Confirm startup detection race condition: At fresh launch, background capability probing/detection is async (`detectStartupAgentStatusesBackground`), causing `getAgentStatuses()` to return empty/stale entries until detection completes.

## Phase 2: Implementation & Resilience Improvements

- [x] Fall back to adapter capabilities: In `supervisorRuntime.ts` and `AgentStatusService.getCachedCapabilities`, fall back to `adapter.capabilities` or `status.capabilities` when `getCachedCapabilities(kind)` returns `undefined`.
- [x] Add catalog warming retry/await mechanism:
  - Add `awaitPendingDetection()` method to `AgentStatusService` to await background startup probing if active.
  - Wire `awaitPendingDetection` into `CampaignAgentRegistry.resolveAll()` so cold startup detection is awaited before resolving an empty catalog.
- [x] Improve failure UX & i18n:
  - Distinguish between "catalog warming up" (`reason: "warming_up"`) vs "provider not detected" (`reason: "not_detected"`) in `resolveProvider` and `ProviderUnavailableError`.
  - Add localized error message keys in `src/shared/messages.ts` and `src/renderer/i18n/sharedMessages.ts`.

## Phase 3: Testing & Verification

- [x] Add unit tests for `CampaignAgentRegistry` with cold capability cache & fallback behavior (`campaignAgentRegistry.test.ts`).
- [x] Add unit tests in `resolve.test.ts` verifying ProviderUnavailableError reason & message formatting.
- [x] Run full test suite (`pnpm exec vitest run src/supervisor src/shared/consultations`), `tsc`, and `lint`.
- [x] Clean commit created.

## Review & Results

### Root Cause

1. **Cold Capabilities Cache**: `AgentStatusService.getCachedCapabilities(kind)` returned `undefined` when `fromCache` was false (fresh boot / missing status cache file). `CampaignAgentRegistry.resolveAll()` dropped any agent whose capability returned `undefined` (`if (!caps) continue;`), dropping Claude Code and other installed agents on boot.
2. **Async Detection Race**: On fresh boot, background capability probing runs asynchronously (`detectStartupAgentStatusesBackground`). Immediately requesting a consultation before probing finishes yielded empty spawnable agents.

### Fix Summary

1. **Capability Fallback**: Modified `getCachedCapabilities` and `CampaignAgentRegistry.resolveAll()` to fall back to live `adapter.capabilities` or Zod-parsed default capabilities when disk cache is unpopulated, preventing agents from being silently dropped.
2. **Pending Detection Awaiting**: Added `awaitPendingDetection()` to `AgentStatusService` and wired it to `CampaignAgentRegistry.resolveAll()` so cold catalog resolution awaits active background probes.
3. **Improved UX & i18n**: Added `reason: "warming_up" | "not_detected"` to `ProviderUnavailableError` and added localized message keys in `src/shared/messages.ts` and `src/renderer/i18n/sharedMessages.ts`.
