# Poracode Experiment Enhancements — Project Overview & Remaining Work

_Last updated: 2026-07-20 · Fork: `Afonjatee2/lightcode` · Branch: `fix/qwen-deepseek-profiles-and-experiment-bugs`_

---

## 1. What this project is

**Poracode** (upstream `SDSLeon/lightcode`) is an Electron desktop app for driving coding
agents. Renderer is SolidJS/React-style TSX under `src/renderer`; the Electron main /
"supervisor" lives under `src/main` and `src/supervisor`; shared Zod contracts under
`src/shared`. It's a pnpm monorepo built with Vite + tsdown, packaged with electron-builder.

Its headline feature is **Experiment**: a *horizontal race*.

> One prompt → N candidate agents, each in its own **isolated git worktree** → a blind **AI
> judge** scores the anonymized diffs → a **winner is crowned** → the winner is **merged** to
> the base branch.

This repo is our **fork**, where we're doing two things:

1. **Bug fixes + provider setup (DONE, shipped on this branch):**
   - Split the broken Qwen preset by plan (Coding vs Token) so endpoint and model agree.
   - Fixed the "Crown with AI" judge-gate deadlock (a failed/hung candidate no longer blocks judging).
   - Documented DeepSeek / Meta Muse Spark direct-key profiles.
   - Support unsigned local macOS builds (`PORACODE_LOCAL_UNSIGNED=1`).

2. **The redesign / enhancement task (this document):** porting four ideas from the
   `opencode-cowork` "Workflow tab" — a *vertical pipeline* (orchestrator → executors →
   reviewer → commit) — into Poracode's Experiment feature.

### The two shapes, and why we're merging them

| | Poracode Experiment (today) | cowork Workflow (the ideas we're porting) |
|---|---|---|
| Shape | Horizontal race | Vertical pipeline |
| Strength | "Who does this best?" | "Take one task from idea → committed diff" |
| Missing | Spec authoring, resilience, human review gate | (had these) |

The goal is to graft the pipeline's missing pieces onto the race, **reusing Poracode's
existing machinery** (one-shot generation, blind judge, worktrees, merge) rather than
bolting on a parallel system.

---

## 2. Design principles (hold to these)

- **Reuse, don't reinvent.** Every phase maps onto existing infra (title-gen / judge /
  worktree / merge). If you're writing a second "classification" or "one-shot" path, stop.
- **One consistent source of truth** per concern (mirrors the same rule we enforce in the
  executor prompts).
- **Each phase ships independently:** its own commit, green `tsc` + `lint` + `test`.
- **i18n gotcha (bit us once):** any new renderer `<Trans>` / `` t` `` / `` msg` `` needs
  `pnpm i18n:extract` before a build, or the text renders **blank**. Supervisor strings are a
  separate flat catalog in `src/shared/messages.ts` (not part of lingui extract).
- **Verify with `tsc`, not just vitest.** vitest transpiles test files without type-checking;
  a green suite can still hide `tsc` errors. Always run `tsc --noEmit` after editing tests.
- **Discoverability > cleverness.** (Phase 1 lesson: a feature gated so tightly it hides
  itself is useless — see §5.)

---

## 3. Status at a glance

| Phase | Feature | Status | Commits |
|---|---|---|---|
| 1 | Orchestrator / "Draft spec" | ✅ Done + verified in a build | `7ebcad1`, `293bdcc`, `7460838` |
| 2 | Rate-limit fallback ladder | 🔨 Contract field started (uncommitted WIP) | — |
| 3 | External-reviewer relay (copy-diff + verdict) | ⬜ Not started | — |
| 4 | Review-then-commit gate | ⬜ Not started | — |

---

## 4. Architecture the phases build on (orientation)

- **Experiment is a *mode* of the normal composer**, not a separate view:
  `src/renderer/components/thread/ThreadDraftComposerArea.tsx` (`experimentMode`,
  `experimentCandidates`, `runExperiment()` → `launchExperiment()`).
- **Create entry point:** `launchExperiment()` in `src/renderer/actions/experimentActions.ts`
  (builds the `Experiment`, creates candidate threads, makes worktrees, launches each).
- **Data model:** `src/shared/contracts/experiment.ts` — `Experiment`, `ExperimentCandidate`
  (`worktreeOwnerToken = ${experimentId}:${threadId}`), and the `crown` **discriminated union
  on `source`** (`"ai" | "user"`). Re-exported via the `src/shared/contracts.ts` barrel.
- **Store:** `src/renderer/state/experimentStore.ts` (`addExperiment`, `setExperimentCrown`,
  `decideExperiment`; persisted, re-validated through `experimentSchema.safeParse`).
- **One-shot generation infra (reused by Phase 1):**
  `src/supervisor/oneShotPromptRunner.ts` → `src/supervisor/runtime/generationService.ts`
  (`requireAdapter`) → IPC procedure → renderer util. `titleGenerator.ts` is the simplest
  text-in/text-out template; `experimentJudge.ts` is the structured-JSON template.
- **Judge / crown / merge:** `crownExperiment` and `mergeExperimentWinner` in
  `src/renderer/actions/experimentDecisionActions.ts`; `commitCandidateChanges` (the single
  stage+commit chokepoint, shared with PR creation); merge via
  `gitCommandRunner.ts` → `src/supervisor/git/mergeService.ts`.
- **Candidate launch + status:** `performInitialThreadLaunch` in
  `src/renderer/actions/threadLaunchActions.ts`; thread status flows from supervisor
  `thread-state` events → `updateThreadRuntime` in `src/renderer/app.tsx`; status enum +
  helpers in `src/shared/contracts/common.ts` (`isThreadTurnActive`, `isThreadResultReady`).
- **Per-candidate diff:** `src/supervisor/git/experimentService.ts` `getCandidateDiff()`
  (returns `{diff, headCommit}`) — **implemented but not yet exposed over IPC** (Phase 3).
- **Eligibility helper:** `isEligibleExperimentJudgeAgent` in
  `src/renderer/actions/experimentOperationState.ts`.

---

## 5. Phase 1 — Orchestrator / "Draft spec"  ✅ DONE

**What it does:** in Experiment mode, a **✨ Draft spec** button (next to "Add candidate")
opens a dialog where you type a one-line task, pick a one-shot agent, and it drafts a full,
editable executor spec (reading the repo read-only) that becomes the experiment prompt — no
more hand-writing the whole spec.

**How it's wired (all committed):**
- `src/supervisor/executorSpecGenerator.ts` — `generateExecutorSpec()` reuses
  `runOneShotPromptWithFallback` (regular runner, `readOnlyWorkspace: true`) + `cleanSpec()`.
- `GenerationService.generateExecutorSpec` → `generateExecutorSpec` IPC procedure
  (`src/shared/ipc/procedures/git.ts` + handler in `src/supervisor/ipcHandlers.ts`) →
  `generateExecutorSpecPayloadSchema` / `GenerateExecutorSpecResult` in
  `src/shared/contracts/git.ts`.
- `src/renderer/utils/executorSpecGen.ts` (`requestExecutorSpec`, thin — agent is user-chosen).
- `src/renderer/components/experiment/ExperimentSpecDraftDialog.tsx` (task input + model
  picker + editable drafted spec).
- `ExperimentDraftTargets.tsx` gained an optional `onDraftSpec` button; the composer wires it.
- Tests: `src/supervisor/executorSpecGenerator.test.ts`.

**Two decisions worth remembering:**
1. Uses the **regular** one-shot runner + `supportsOneShot` gate (NOT the text-only variant —
   only `claude` implements text-only, which would restrict orchestration to Claude alone).
2. The button is **always visible** in experiment mode. It was originally gated on the strict
   AI-judge eligibility, which hid it entirely for agent line-ups that don't pass that gate
   (the same reason the in-app "Crown with AI" judge is often unavailable — see §7). Hiding a
   new feature makes it undiscoverable. Now the dialog shows a clear message if no
   one-shot-capable agent exists, instead of hiding.

---

## 6. Remaining work — three phases

Implement in order. Each is its own commit + green `tsc`/`lint`/`test`. Build the DMG **once**
at the very end (§8), not per phase.

### Phase 2 — Rate-limit fallback ladder  🔨 (riskiest)

**Goal:** when a candidate's agent fails (e.g. rate-limited / 429 / crash), automatically
relaunch **that same candidate thread**, in its **existing worktree**, with the **next agent
in a configured chain** (e.g. Codex → Qwen → DeepSeek). This is the resilience piece and ties
back to the original cost-saving goal (cheap models take over when the premium one is limited).

**Why it's needed / what's missing today:** there is no per-candidate agent-swap relaunch, and
no distinct rate-limit thread status — Claude 429 and a hard crash both collapse to
`status:"error"`.

**Decisions (resolved — don't re-litigate):**
- **Trigger on any `status:"error"`.** Distinguishing "429" from "crash" would need a new
  agent-event intent (protocol bump) or `errorMessage` plumbed onto the live thread-state path
  (currently dropped). Any-error covers 429 with zero contract churn; classification is a
  deferrable refinement.
- **Keep the same `threadId`** on relaunch — preserves `worktreeOwnerToken` and the worktree
  binding. `closeExperimentThread` stops the session but keeps the thread row.
- **Controller lives in the renderer** — all experiment/candidate state + launch orchestration
  are there; the supervisor is experiment-agnostic.
- **Guardrails:** hard-cap advances at chain length; only advance when experiment is
  `running`, the candidate's `worktreeState==="owned"`, and a `worktreePath` exists (this skips
  the *initial*-launch error path); guard re-entrancy. NB: an *uncapped* ladder would block
  merge forever via `hasActiveExperimentCandidate`, hence the cap. The judge-gate is already
  safe — `resultReadyExperimentThreadIds` excludes a relaunching candidate.

**What to build:**
1. **Contract (started, uncommitted):** optional `fallbackChain: z.array(agentKindSchema).max(MAX_EXPERIMENT_FALLBACK_CHAIN).optional()`
   on `experimentCandidateSchema` in `src/shared/contracts/experiment.ts`. Additive/optional →
   backward-compatible, no store version bump. _(This field + the `MAX_EXPERIMENT_FALLBACK_CHAIN`
   constant are already in the working tree; commit them with the rest of Phase 2.)_
2. **`setThreadAgentKind(threadId, {agentKind, agentInstanceId?, config})`** in
   `src/renderer/state/slices/threadSlice.ts` — existing `updateThreadConfig` only touches
   model/effort; the new mutator must also swap `agentKind`/`agentInstanceId` **and** reset
   `config` to the new agent's valid model/effort/fast (use the `resolveModelValue` /
   `resolveEffortValue` / `resolveFastValue` helpers). Keep the same `threadId`.
3. **`updateCandidateAgent(experimentId, threadId, patch)`** in `experimentStore.ts` — mirror
   `setExperimentCrown`; patches the candidate's `agentKind`/`model`/`effort`/`fast`.
4. **New `src/renderer/actions/experimentFallbackController.ts`** —
   `maybeAdvanceExperimentFallback(threadId)`: find the candidate + experiment, pick the next
   eligible agent in its `fallbackChain` (filter installed + one-shot-agnostic; respect
   `disabledAgents`), then `closeExperimentThread` → `setThreadAgentKind` + `updateCandidateAgent`
   → `performInitialThreadLaunch(...)` into `buildWorktreeLocation(project.location, worktreePath)`,
   mirroring the launch loop in `experimentActions.ts`. Track a per-thread cursor in an
   in-memory `Map<threadId, index>` for v1.
5. **Hook:** one line in the existing `status==="error"` branch of the `thread-state` handler in
   `src/renderer/app.tsx`: `void maybeAdvanceExperimentFallback(event.threadId)`.
6. **UI:** a per-candidate chain editor in
   `src/renderer/components/experiment/ExperimentDraftTargets.tsx` (+ optional `fallbackChain`
   on `ExperimentCandidateSpec` in `experimentActions.ts`), threaded through `runExperiment` →
   `candidateRecord`. Reuse the provider menu for picking chain agents.

**Verify:** `experimentFallbackController.test.ts` (advances on error, respects cap, skips
non-owned / initial-launch errors, honours `disabledAgents`, no-op when chain exhausted);
extend `experimentStore.test.ts`; add a `threadSlice` test (agentKind swap resets config).

**v1 defers:** rate-limit-specific classification; persisting the ladder cursor across restarts.

---

### Phase 3 — External-reviewer relay (copy-diff + verdict)  ⬜

**Goal:** let a human — or an external tool like ChatGPT web — act as judge instead of the
built-in AI. Add a per-candidate **Copy diff** button and a manual **Approve / Request-changes**
verdict. This productizes what's done by hand today (copy candidate diffs → paste into ChatGPT →
apply the winner).

**What to build:**
1. **Contract (`src/shared/contracts/experiment.ts`):** add a third arm to the crown `source`
   discriminated union — `source:"external"` carrying `verdict: z.enum(["approve","request-changes"])`
   + optional `note`. Extend the `superRefine` invariants so an `external` crown with
   `verdict:"request-changes"` does **not** satisfy "a decided experiment must have a winner"
   (request-changes is advisory, non-merging). The diff payload/result types
   (`getExperimentCandidateDiffPayloadSchema`, `GetExperimentCandidateDiffResult`) already exist.
   **Bump `EXPERIMENT_STORE_VERSION`** and add a passthrough `migrate: (s)=>s` (zustand v5 nulls
   persisted state on a version mismatch with no migrate). One-way caveat: a persisted
   `external` crown fails `safeParse` on an older build → that experiment silently drops on
   downgrade (acceptable).
2. **IPC — expose the already-implemented diff:** add a `getExperimentCandidateDiff` procedure
   (mirror `getExperimentCandidateStats`) in `src/shared/ipc/procedures/experiment.ts` +
   handler in `src/supervisor/ipcHandlers.ts` → supervisor `git.getExperimentCandidateDiff`.
3. **Renderer:** `setExternalExperimentCrown(experimentId, threadId, verdict, note?)` in
   `experimentDecisionActions.ts` (mirror `setManualExperimentCrown`). For the "copy everything
   for an external judge" payload, reuse the anonymized prompt+diff assembly already in
   `src/supervisor/experimentJudge.ts`.
4. **UI:** in `ExperimentCandidateCard.tsx` add a **Copy diff** control (reuse
   `CopyTextButton`) that fetches via the new IPC (mirror the existing stats `useEffect`), plus
   an external-verdict action; wire `onExternalVerdict` in `ExperimentView.tsx` beside
   `onCrown`; render a read-only verdict view reusing the `openResults` path.

**Verify:** extend `experiment.test.ts` (external arm + superRefine cases),
`ExperimentCandidateCard.test.tsx` (copy-diff fetch + verdict action), a decision-action test
for `setExternalExperimentCrown`.

**v1 defers:** any automated round-trip/import of the external reviewer's response.

---

### Phase 4 — Review-then-commit gate  ⬜

**Goal:** before merging the winner, force a diff review so nothing lands blind (this is what
kept a stray file out of `main` in the past).

**What to build (renderer UI only — no supervisor/IPC/contract changes):** in the merge
`ConfirmDialog` / `confirmMerge` of `src/renderer/views/ExperimentView/ExperimentView.tsx`, add
a **"Review changes"** action that calls `showGitReviewPanel(project.id, crownedCandidate.worktreePath)`
(`src/renderer/actions/panelActions.ts`, already used from the candidate card), and require an
explicit "I reviewed these changes" acknowledgment before the confirm button enables.

**Decision:** gate the merge-confirmation **UI**, leave `commitCandidateChanges` untouched —
that helper is shared with PR creation, which shouldn't be gated.

**Verify:** extend `ExperimentView.test.tsx` (merge blocked until acknowledged; "Review
changes" opens the panel).

**v1 defers (optional hardening):** tighten `commitCandidateChanges` staging from `git add .`
to explicit pathspecs.

---

## 7. Known issues & roadmap extras (not in the 4 phases)

- **In-app AI judge is unavailable for some agent line-ups.** `isEligibleExperimentJudgeAgent`
  requires `installed && authState !== "missing" && supportsOneShot && models.length > 0`.
  Setups whose agents don't pass this (why the workflow relies on ChatGPT to judge externally)
  get no in-app "Crown with AI" and — before the Phase 1 fix — no Draft-spec button either.
  Worth investigating why CLI/profile agents (Kimi Code, Qwen Code) don't register as
  one-shot-eligible, so the in-app judge works and external relay becomes optional.
- **Experiment branches leak the prompt.** Poracode names the experiment branch (and the PR
  head commit `chore: apply experiment winner`) from the *executor prompt text*, e.g.
  `poracode/experiment-You-are-an-autonomous-co-Qwen3.8-Max-...`. It leaks the prompt into git
  and looks terrible in PRs. A "Phase 2.5" clean-naming fix is a good candidate. (Workaround
  today: **squash-merge** experiment PRs with a clean message so it never reaches `main`.)

---

## 8. Build / test / verify reference

**Toolchain:** system Node is v22; the DMG build requires **Node 24** (`~/.nvm` has v24.18.0).
Iterate with system Node; switch only for the packaging step.

```bash
# from ~/Downloads/lightcode
pnpm run codex-protocol:gen        # once, if deps were installed with --ignore-scripts
node_modules/.bin/tsc --noEmit -p tsconfig.json          # typecheck
node_modules/.bin/vitest run --configLoader runner <path># targeted tests
node_modules/.bin/oxlint --deny-warnings src             # lint (plain)
node_modules/.bin/oxlint --type-aware --deny-warnings -c .oxlintrc.type-aware.json src
pnpm i18n:extract                  # AFTER adding any renderer <Trans>/t`/msg` string

# package an unsigned local DMG (Node 24)
PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH" \
  PORACODE_LOCAL_UNSIGNED=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:mac:arm
# → release/Poracode-1.5.2-arm64.dmg  and  release/mac-arm64/Poracode.app
```

**Verify a build actually contains a change:** mount the DMG (or use `release/mac-arm64/`) and
grep the bundle for a new string, e.g.
`grep -ac 'Draft spec from a task' .../Poracode.app/Contents/Resources/app.asar`. This is the
check that caught both the blank-i18n bug and the "running a stale duplicate app" confusion.

**Clean install (avoids macOS "Keep Both" duplicates):** fully quit Poracode, then
`rm -rf "/Applications/Poracode.app" "/Applications/Poracode 2.app"` and
`cp -R release/mac-arm64/Poracode.app /Applications/Poracode.app` before reopening.

---

## 9. Where each phase's commit goes

Commit each phase separately on `fix/qwen-deepseek-profiles-and-experiment-bugs`, push to
`Afonjatee2/lightcode` (updates the open PR). Phase 3 is the only contract/store-version bump;
Phases 2 has a contract *field*; Phase 4 is UI-only.
