#!/usr/bin/env node
/**
 * Real-IPC Electron acceptance for the Phase 4 campaign-consultation feature
 * (standard/panel consultations, retry, context packets, restart persistence,
 * two-thread isolation). Drives `window.poracode.*` through raw CDP against
 * two full app launches (first session + real stop/relaunch), exactly like a
 * user would trigger these flows — no DOM scraping, no mocked bridge.
 *
 * This intentionally keeps its own small CDP client rather than importing
 * poracode-cdp.mjs: that script is a single-shot CLI (`node poracode-cdp.mjs
 * <cmd>`, one process per call) with no exported functions, which is a poor
 * fit for a long stateful scenario needing dozens of sequential evaluate()
 * calls over one persistent WebSocket. It follows the same conventions
 * (PORACODE_CDP_PORT/PORACODE_APP_URL/PORACODE_BASE_DIR, window.__poracodeDev)
 * documented in SKILL.md. It does reuse seed-poracode-smoke-db.mjs for the
 * base fixture, same as the runner.
 *
 * Usage: node .agents/skills/interactive-testing/scripts/phase4-consultation-smoke.mjs
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import net from "node:net";

const repoRoot = process.cwd();
const root = resolve(join(homedir(), ".poracode-smoke", `phase4-smoke-${Date.now()}-${process.pid}`));

// Real agent CLIs (codex/claude/gemini/...) may be installed globally on the
// dev machine running this script, often in the same bin directory as pnpm
// itself. If the isolated app can still find them on PATH, an
// installed-but-unauthenticated provider probe can hard-crash the supervisor
// process instead of reporting a clean "provider not installed" — which
// defeats the whole point of an isolated, no-real-credentials smoke run.
// Shim pnpm into its own directory via a symlink so the *real* bin directory
// (and every agent CLI in it) can be dropped from the spawned app's PATH.
const pnpmBin = resolvePnpmBin();
const isolatedPath = buildIsolatedPath();

function resolvePnpmBin() {
  try {
    return execFileSync(process.platform === "win32" ? "where" : "which", ["pnpm"]).toString().trim().split("\n")[0];
  } catch {
    return "pnpm";
  }
}

function buildIsolatedPath() {
  // Note: "opencode" is deliberately excluded even though it may be globally
  // installed — on this machine it lives in /opt/homebrew/bin alongside
  // python3, which the native electron-rebuild step needs; stripping that
  // whole directory to hide one binary would risk breaking the build.
  const agentBinNames = ["codex", "claude", "gemini", "grok", "qwen", "kimi", "commandcode", "cursor", "copilot"];
  const dirsToStrip = new Set();
  for (const name of agentBinNames) {
    try {
      const found = execFileSync(process.platform === "win32" ? "where" : "which", [name]).toString().trim().split("\n")[0];
      if (found) dirsToStrip.add(dirname(found));
    } catch {
      // not installed — nothing to strip for this one
    }
  }
  const remaining = (process.env.PATH ?? "").split(delimiter).filter((entry) => !dirsToStrip.has(entry));
  if (dirsToStrip.has(dirname(pnpmBin)) && process.platform !== "win32") {
    const shimDir = join(root, "path-shim");
    mkdirSync(shimDir, { recursive: true });
    symlinkSync(pnpmBin, join(shimDir, "pnpm"));
    return [shimDir, ...remaining].join(delimiter);
  }
  return remaining.join(delimiter);
}
const dataDir = join(root, "data");
const homeDir = join(root, "home");
const localAppDataDir = join(root, "local-app-data");
const roamingAppDataDir = join(root, "roaming-app-data");
const projectDir = join(root, "project");
const outDir = join(root, "artifacts");
const seedScript = join(repoRoot, ".agents/skills/interactive-testing/scripts/seed-poracode-smoke-db.mjs");
const report = {
  startedAt: new Date().toISOString(),
  root,
  checks: {},
  screenshots: {},
  consoleErrors: [],
  failures: [],
};

let appProcess = null;
let client = null;

try {
  await createFixture();
  const firstPorts = await allocatePortPair();
  appProcess = await launchApp(firstPorts);
  client = await connectAndWaitStable(firstPorts);
  const first = await runFirstSession(client);
  report.checks.firstSession = first;
  await client.close();
  client = null;
  await stopProcess(appProcess);
  appProcess = null;

  const secondPorts = await allocatePortPair();
  appProcess = await launchApp(secondPorts);
  client = await connectAndWaitStable(secondPorts);
  const restart = await runRestartSession(client, first);
  report.checks.restart = restart;
  report.finishedAt = new Date().toISOString();
  report.status = "pass";
} catch (error) {
  report.finishedAt = new Date().toISOString();
  report.status = "fail";
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  try {
    await client?.close();
  } catch {
    // best-effort teardown
  }
  await stopProcess(appProcess);
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "phase4-consultation-smoke-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PHASE4_SMOKE_REPORT=${reportPath}`);
  console.log(`PHASE4_SMOKE_ROOT=${root}`);
  console.log(`PHASE4_SMOKE_STATUS=${report.status}`);
}

async function createFixture() {
  await Promise.all([
    mkdir(projectDir, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(localAppDataDir, { recursive: true }),
    mkdir(roamingAppDataDir, { recursive: true }),
    mkdir(outDir, { recursive: true }),
  ]);
  await writeFile(join(projectDir, "README.md"), "# Phase 4 consultation smoke fixture\n");
  execFileSync("git", ["init", "-q"], { cwd: projectDir });
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync(
    "git",
    ["-c", "user.name=Poracode Phase4 Smoke", "-c", "user.email=phase4-smoke@poracode.local", "commit", "-qm", "initial fixture"],
    { cwd: projectDir },
  );
  execFileSync(
    process.execPath,
    ["--no-warnings", seedScript, "--baseDir", dataDir, "--projectDir", projectDir, "--reset"],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

async function allocatePortPair() {
  const holds = [];
  try {
    const cdpPort = await freePort(holds);
    const vitePort = await freePort(holds);
    return { cdpPort, vitePort, appUrl: `http://127.0.0.1:${vitePort}/` };
  } finally {
    for (const server of holds) server.close();
  }
}

function freePort(holds) {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      holds.push(server);
      resolvePort(server.address().port);
    });
  });
}

async function launchApp(ports) {
  console.log(`Launching isolated Poracode: ${JSON.stringify(ports)}`);
  const child = spawn(pnpmBin, ["run", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: isolatedPath,
      PORACODE_DEV_SERVER_PORT: String(ports.vitePort),
      PORACODE_CDP_PORT: String(ports.cdpPort),
      PORACODE_BASE_DIR: dataDir,
      PORACODE_CONSULTATION_FIXTURE_CONTEXT: "1",
      PORACODE_SMOKE_OUT_DIR: outDir,
      ...(process.platform === "darwin" ? { PORACODE_USE_MOCK_KEYCHAIN: "1" } : {}),
      HOME: homeDir,
      USERPROFILE: homeDir,
      LOCALAPPDATA: localAppDataDir,
      APPDATA: roamingAppDataDir,
      PSModuleAnalysisCachePath: join(root, "powershell", "ModuleAnalysisCache"),
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[app] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[app] ${chunk}`));
  await waitForTarget(ports, 150_000);
  return child;
}

async function connectApp(ports) {
  const target = await findTarget(ports);
  const connection = await connectTarget(target, 120_000);
  await connection.send("Page.enable");
  await connection.send("Runtime.enable");
  connection.on("Runtime.exceptionThrown", (event) => {
    report.consoleErrors.push(
      event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? "runtime exception",
    );
  });
  connection.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error" || event.type === "assert") {
      report.consoleErrors.push(event.args?.map((arg) => arg.value ?? arg.description).join(" ") ?? "console error");
    }
  });
  return connection;
}

/**
 * `electronmon` (dev mode) restarts the whole Electron main process (and the
 * forked supervisor child inside it) whenever it observes the just-built main
 * bundle change — which can still be settling seconds after the CDP target
 * first appears, tearing down the supervisor mid-connect ("Supervisor
 * exited"). This is a dev-tooling race, not a Phase 4 defect: ride it out by
 * reconnecting to a fresh target and retrying a benign real IPC call until
 * the supervisor answers, or give up after a generous timeout.
 */
async function connectAndWaitStable(ports) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    let connection;
    try {
      connection = await connectApp(ports);
      await prepareRenderer(connection);
      await bridge(connection, "dbGetProjects");
      return connection;
    } catch (error) {
      lastError = error;
      try {
        await connection?.close();
      } catch {
        // best-effort teardown of the doomed connection
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!/Supervisor exited|Supervisor is not running/.test(message)) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  }
  throw new Error(`app never reached a stable supervisor connection: ${lastError?.message ?? lastError}`);
}

async function prepareRenderer(connection) {
  await waitForValue(
    () => evaluate(connection, `({ ready: document.readyState, bridge: typeof window.poracode })`),
    (value) => value.bridge === "object" && value.ready !== "loading",
    "preload bridge and renderer document",
    120_000,
  );
  await evaluate(
    connection,
    `import('/src/renderer/devBridge.ts').then((module) => {
      module.installDevBridge();
      return typeof window.__poracodeDev;
    })`,
    true,
  );
  await evaluate(
    connection,
    `(() => {
      localStorage.setItem('poracode-welcome-seen-v16', 'true');
      const button = document.querySelector('.poracode-welcome-page button');
      if (button instanceof HTMLButtonElement) button.click();
      return true;
    })()`,
  );
  await waitForValue(
    () =>
      evaluate(
        connection,
        `({
          bridge: typeof window.poracode,
          dev: typeof window.__poracodeDev,
          root: document.querySelector('#root')?.childElementCount ?? 0,
          welcome: Boolean(document.querySelector('.poracode-welcome-page')),
        })`,
      ),
    (value) => value.bridge === "object" && value.dev === "object" && value.root > 0 && !value.welcome,
    "renderer and DEV bridge",
    60_000,
  );
}

async function runFirstSession(connection) {
  const now = new Date().toISOString();
  const project = {
    id: "phase4-campaign-project",
    name: "AIB Campaign",
    purpose: "campaign",
    campaignExtension: {
      campaignGroupId: "cg-aib-2026",
      clientName: "AIB NI",
      campaignName: "Community Fund 2026",
      jobNumber: "JOB-2026-041",
      defaultAgentKind: "codex",
      defaultModel: "gpt-5.6",
      mcpProfile: "monitoring",
      resourceAliases: { "@media-plans": "drive://media-plans/aib" },
    },
    location: { kind: "posix", path: projectDir },
    mcpServers: [],
    createdAt: now,
  };
  const thread1 = makeThread("phase4-thread-1", project.id, "Campaign Consultation", now);
  const thread2 = makeThread("phase4-thread-2", project.id, "Second Campaign Pane", now);

  await bridge(connection, "dbUpsertProject", project);
  await bridge(connection, "dbUpsertThread", thread1);
  await bridge(connection, "dbUpsertThread", thread2);
  await bridge(connection, "dbReplaceThreadRuntimeItems", {
    threadId: thread1.id,
    items: [
      {
        id: "parent-user-1",
        type: "user_message",
        state: "completed",
        payload: {
          content: [{ kind: "text", text: "The campaign budget is £100,000 and spend to date needs verification." }],
        },
        streams: {},
      },
      {
        id: "parent-assistant-1",
        type: "assistant_message",
        state: "completed",
        payload: { content: [{ kind: "text", text: "I will verify the campaign figures." }] },
        streams: { assistant_text: "I will verify the campaign figures." },
      },
    ],
  });
  await setStoreThreads(connection, [project], [thread1, thread2], thread1.id);
  await waitForText(connection, "Campaign Consultation", 30_000);
  report.screenshots.campaignThread = join(outDir, "phase4-01-campaign-thread.png");
  await screenshot(connection, report.screenshots.campaignThread);

  const standardSubmit = await bridge(connection, "consultationSubmit", {
    projectId: project.id,
    parentThreadId: thread1.id,
    campaignGroupId: project.campaignExtension.campaignGroupId,
    message: "@codex verify these figures",
  });
  assert(standardSubmit.ok, `standard submit failed: ${JSON.stringify(standardSubmit)}`);
  await waitForText(connection, "verify these figures", 30_000);

  const contextState = await waitForValue(
    () => bridge(connection, "consultationListForThread", { parentThreadId: thread1.id }),
    (value) => value.contextPackets.length >= 1,
    "standard context packet",
    45_000,
  );
  const standardRecord = contextState.consultations.find((record) => record.id === standardSubmit.consultation.id);
  const packet = contextState.contextPackets.find(
    (candidate) => candidate.consultationId === standardSubmit.consultation.id,
  );
  assert(packet, "standard consultation context packet was not persisted");
  assert(
    standardRecord?.contextPacketId === packet.id,
    "standard consultation record's contextPacketId does not match the persisted packet (live hydration link is broken)",
  );
  assert(
    packet.structuredContext.relevantRecentConversation.some((turn) => turn.content.includes("£100,000")),
    "real parent conversation was not included in the context packet",
  );
  assert(packet.structuredContext.campaignIdentity.campaignGroupId === "cg-aib-2026", "fixture campaign context was not used");
  assert(
    packet.structuredContext.budget.totalBudget !== null,
    "standard fixture unexpectedly had no budget (hasBudget derivation would be untestable)",
  );
  report.screenshots.contextReady = join(outDir, "phase4-02-context-ready.png");
  await screenshot(connection, report.screenshots.contextReady);

  const terminalState = await waitForValue(
    () => bridge(connection, "consultationGet", { id: standardSubmit.consultation.id }),
    (value) => ["completed", "failed", "cancelled"].includes(value.consultation?.status),
    "standard terminal state",
    60_000,
  );
  assert(terminalState.consultation, "standard consultation disappeared");
  report.screenshots.standardTerminal = join(outDir, "phase4-03-standard-terminal.png");
  await screenshot(connection, report.screenshots.standardTerminal);

  let standardRetry = null;
  if (["failed", "cancelled"].includes(terminalState.consultation.status)) {
    standardRetry = await bridge(connection, "consultationRetry", { id: terminalState.consultation.id });
    assert(
      standardRetry.consultation?.retryOfConsultationId === terminalState.consultation.id,
      "standard retry relationship was not persisted",
    );
  }

  // Panel: submit, then reach a genuinely cancelled panel through real IPC
  // (not a synthetic DB row) before retrying. With no real provider
  // credentials in this isolated profile, both members fail within ~35ms and
  // the panel's "all_required" completion rule still synthesizes an overall
  // "completed" result (failures are reported per-member inside the
  // synthesis, not as a panel-level failure) — so a plain submit-then-cancel
  // issued as two separate round-tripped IPC calls always loses that race.
  // Submitting and cancelling in a single evaluate() (one WebSocket
  // round-trip, no gap for the panel to finish in between) reliably lands
  // the cancel while the panel is still in flight.
  const panelSubmitAndCancel = await evaluate(
    connection,
    `window.poracode.consultationSubmitPanel(${JSON.stringify({
      projectId: project.id,
      parentThreadId: thread1.id,
      campaignGroupId: project.campaignExtension.campaignGroupId,
      message: "@panel assess the channel mix",
      members: [
        { role: "strategic_reviewer", requiredOrOptional: "required", requestedProvider: "codex", requestedModel: "gpt-5.6" },
        { role: "figures_auditor", requiredOrOptional: "optional", requestedProvider: "codex", requestedModel: "gpt-5.6" },
      ],
    })}).then((submitResult) =>
      window.poracode.consultationCancel({ id: submitResult.consultation.id }).catch(() => null).then(() => submitResult),
    )`,
    true,
  );
  const panelSubmit = panelSubmitAndCancel;
  assert(panelSubmit.ok, `panel submit failed: ${JSON.stringify(panelSubmit)}`);
  const originalPanelId = panelSubmit.consultation.id;
  const originalTerminal = await waitForValue(
    () => bridge(connection, "consultationGet", { id: originalPanelId }),
    (value) => ["cancelled", "failed"].includes(value.consultation?.status),
    "panel reaching a cancelled-or-failed terminal state",
    30_000,
  );
  console.log(`Panel reached terminal status: ${originalTerminal.consultation.status}`);
  const preRetryMembership = await waitForValue(
    () => bridge(connection, "consultationListForThread", { parentThreadId: thread1.id }),
    (value) => value.panelMembers.filter((member) => member.parentPanelConsultationId === originalPanelId).length === 2,
    "original panel membership",
    30_000,
  );
  const originalMemberships = preRetryMembership.panelMembers.filter(
    (member) => member.parentPanelConsultationId === originalPanelId,
  );
  await waitForText(connection, "Retry panel", 30_000);
  report.screenshots.panelCancelled = join(outDir, "phase4-04-panel-cancelled.png");
  await screenshot(connection, report.screenshots.panelCancelled);

  const panelRetryResult = await bridge(connection, "consultationRetry", { id: originalPanelId });
  const retryPanel = panelRetryResult.consultation;
  assert(retryPanel?.consultationMode === "panel", "panel retry was converted to a standard consultation");
  assert(retryPanel.retryOfConsultationId === originalPanelId, "panel retry relationship is missing");
  const panelList = await waitForValue(
    () => bridge(connection, "consultationListForThread", { parentThreadId: thread1.id }),
    (value) => value.panelMembers.filter((member) => member.parentPanelConsultationId === retryPanel.id).length === 2,
    "retried panel membership",
    30_000,
  );
  const retryMemberships = panelList.panelMembers.filter((member) => member.parentPanelConsultationId === retryPanel.id);
  assert(
    retryMemberships.length === originalMemberships.length,
    `retried panel member count was ${retryMemberships.length}, original had ${originalMemberships.length}`,
  );
  assert(retryMemberships.length === 2, `retried panel member count was ${retryMemberships.length}, expected exactly 2 (not 4)`);
  for (let i = 0; i < originalMemberships.length; i += 1) {
    assert(retryMemberships[i]?.memberRole === originalMemberships[i]?.memberRole, "panel retry did not preserve member order/role");
    assert(
      retryMemberships[i]?.requiredOrOptional === originalMemberships[i]?.requiredOrOptional,
      "panel retry did not preserve required/optional",
    );
  }
  const retryChildren = retryMemberships.map((membership) =>
    panelList.consultations.find((record) => record.id === membership.childConsultationId),
  );
  assert(retryChildren.every((child) => child?.requestedProvider === "codex"), "panel retry lost requested provider");
  assert(retryChildren.every((child) => child?.requestedModel === "gpt-5.6"), "panel retry lost requested model");
  try {
    await bridge(connection, "consultationCancel", { id: retryPanel.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|terminal|not cancellable/i.test(message)) throw error;
  }
  report.screenshots.panelRetry = join(outDir, "phase4-05-panel-retry.png");
  await screenshot(connection, report.screenshots.panelRetry);

  // Context-hydration warnings: a second campaign group whose deterministic
  // fixture health status resolves to "stale" (verified offline, not random -
  // see deterministicSeed in fixtureCampaignContextProvider.ts), so the
  // ContextWarnings chip renders from real packet content, live, without
  // reopening the thread.
  const warnGroupId = "cg-phase4-ctx-warn";
  const warnSubmit = await bridge(connection, "consultationSubmit", {
    projectId: project.id,
    parentThreadId: thread2.id,
    campaignGroupId: warnGroupId,
    message: "@codex check source health",
  });
  assert(warnSubmit.ok, `context-warning submit failed: ${JSON.stringify(warnSubmit)}`);
  const warnState = await waitForValue(
    () => bridge(connection, "consultationListForThread", { parentThreadId: thread2.id }),
    (value) => value.contextPackets.some((p) => p.consultationId === warnSubmit.consultation.id),
    "context-warning packet",
    45_000,
  );
  const warnPacket = warnState.contextPackets.find((p) => p.consultationId === warnSubmit.consultation.id);
  assert(warnPacket.structuredContext.evidenceFreshness.staleSourceCount >= 1, "expected fixture's stale source was not present in the packet");
  await evaluate(connection, `window.__poracodeDev.stores.app.getState().openThread(${JSON.stringify(thread2.id)})`);
  await waitForText(connection, "stale data source", 30_000);
  report.screenshots.contextWarning = join(outDir, "phase4-08-context-warning.png");
  await screenshot(connection, report.screenshots.contextWarning);
  const standardConsultAbsentWarning = await evaluate(
    connection,
    `(document.body.textContent ?? "").includes("Control Centre connection unavailable")`,
  );
  assert(
    standardConsultAbsentWarning === false,
    "controlCentreAvailable warning appeared even though a real packet is present — flag looks hard-coded, not packet-derived",
  );

  // Two-thread isolation: concurrent submit across threads, then prove
  // switching away and back does not drop either thread's records.
  const [thread1Concurrent, thread2Concurrent] = await Promise.all([
    bridge(connection, "consultationSubmit", {
      projectId: project.id,
      parentThreadId: thread1.id,
      campaignGroupId: project.campaignExtension.campaignGroupId,
      message: "@codex concurrent check thread 1",
    }),
    bridge(connection, "consultationSubmit", {
      projectId: project.id,
      parentThreadId: thread2.id,
      campaignGroupId: project.campaignExtension.campaignGroupId,
      message: "@codex concurrent check thread 2",
    }),
  ]);
  assert(thread1Concurrent.ok && thread2Concurrent.ok, "concurrent submission across two different threads was blocked");

  await evaluate(connection, `window.__poracodeDev.stores.app.getState().openThread(${JSON.stringify(thread1.id)})`);
  const thread1BeforeSwitch = await bridge(connection, "consultationListForThread", { parentThreadId: thread1.id });
  await evaluate(connection, `window.__poracodeDev.stores.app.getState().openThread(${JSON.stringify(thread2.id)})`);
  await evaluate(connection, `window.__poracodeDev.stores.app.getState().openThread(${JSON.stringify(thread1.id)})`);
  const thread1AfterSwitch = await bridge(connection, "consultationListForThread", { parentThreadId: thread1.id });
  assert(
    thread1AfterSwitch.consultations.length === thread1BeforeSwitch.consultations.length,
    "loading thread B and switching back changed thread A's consultation count",
  );
  assert(
    thread1AfterSwitch.consultations.every((record) => record.parentThreadId === thread1.id),
    "a thread-2 consultation leaked into thread 1's list after switching",
  );

  const secondSubmit = await bridge(connection, "consultationSubmit", {
    projectId: project.id,
    parentThreadId: thread2.id,
    campaignGroupId: project.campaignExtension.campaignGroupId,
    message: "@challenge review the second pane",
  });
  assert(secondSubmit.ok, "second-pane consultation did not submit");
  await evaluate(
    connection,
    `window.__poracodeDev.stores.app.setState({ view: { kind: 'thread', panes: ${JSON.stringify([thread1.id, thread2.id])} } })`,
  );
  await waitForText(connection, "review the second pane", 30_000);
  report.screenshots.twoPanes = join(outDir, "phase4-06-two-panes.png");
  await screenshot(connection, report.screenshots.twoPanes);

  const persistedProjects = await bridge(connection, "dbGetProjects");
  const persisted = persistedProjects.find((candidate) => candidate.id === project.id);
  assert(JSON.stringify(persisted) === JSON.stringify(project), "complete campaign project did not round-trip before restart");

  return {
    project,
    thread1,
    thread2,
    standardConsultationId: standardSubmit.consultation.id,
    standardTerminalStatus: terminalState.consultation.status,
    standardFailureCode: terminalState.consultation.failureCode,
    standardRetryId: standardRetry?.consultation?.id ?? null,
    panelId: originalPanelId,
    panelRetryId: retryPanel.id,
    panelRetryMemberCount: retryMemberships.length,
    panelOriginalMemberCount: originalMemberships.length,
    warnConsultationId: warnSubmit.consultation.id,
    secondConsultationId: secondSubmit.consultation.id,
    contextConversationCount: packet.structuredContext.relevantRecentConversation.length,
  };
}

async function runRestartSession(connection, first) {
  const projects = await bridge(connection, "dbGetProjects");
  const threads = await bridge(connection, "dbGetThreads");
  const persistedProject = projects.find((project) => project.id === first.project.id);
  assert(JSON.stringify(persistedProject) === JSON.stringify(first.project), "complete campaign project changed after restart");
  assert(threads.some((thread) => thread.id === first.thread1.id), "first campaign thread is missing after restart");
  assert(threads.some((thread) => thread.id === first.thread2.id), "second campaign thread is missing after restart");

  await setStoreThreads(connection, projects, threads, first.thread1.id);
  const list = await waitForValue(
    () => bridge(connection, "consultationListForThread", { parentThreadId: first.thread1.id }),
    (value) => value.consultations.some((record) => record.id === first.standardConsultationId),
    "restored consultation records",
    45_000,
  );
  await waitForText(connection, "verify these figures", 30_000);
  report.screenshots.restart = join(outDir, "phase4-07-restart-restored.png");
  await screenshot(connection, report.screenshots.restart);
  return {
    projectRoundTrip: true,
    restoredConsultationCount: list.consultations.length,
    restoredPanelMembershipCount: list.panelMembers.length,
    restoredPanelRetryMembershipCount: list.panelMembers.filter(
      (member) => member.parentPanelConsultationId === first.panelRetryId,
    ).length,
    standardRestored: list.consultations.some((record) => record.id === first.standardConsultationId),
    panelRetryRestored: list.consultations.some((record) => record.id === first.panelRetryId),
  };
}

function makeThread(id, projectId, title, now) {
  return {
    id,
    projectId,
    title,
    agentKind: "codex",
    config: { model: "gpt-5.6" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: now,
    updatedAt: now,
  };
}

async function setStoreThreads(connection, projects, threads, openThreadId) {
  return evaluate(
    connection,
    `(() => {
      const store = window.__poracodeDev.stores.app;
      store.setState({ projects: ${JSON.stringify(projects)}, threads: ${JSON.stringify(threads)} });
      store.getState().openThread(${JSON.stringify(openThreadId)});
      return store.getState().view;
    })()`,
  );
}

async function bridge(connection, method, payload) {
  const expression =
    payload === undefined
      ? `window.poracode[${JSON.stringify(method)}]()`
      : `window.poracode[${JSON.stringify(method)}](${JSON.stringify(payload)})`;
  return evaluate(connection, expression, true);
}

async function waitForText(connection, text, timeoutMs) {
  return waitForValue(
    () => evaluate(connection, `(document.body.textContent ?? "").includes(${JSON.stringify(text)})`),
    Boolean,
    `text ${JSON.stringify(text)}`,
    timeoutMs,
  );
}

async function waitForTarget(ports, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const target = await findTarget(ports);
      if (target) return;
    } catch {
      // keep polling until the CDP endpoint is up
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`timed out waiting for Electron CDP target on ${ports.cdpPort}`);
}

async function findTarget(ports) {
  const response = await fetch(`http://127.0.0.1:${ports.cdpPort}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
  const targets = await response.json();
  const target = targets.find((candidate) => candidate.type === "page" && candidate.url === ports.appUrl);
  if (!target) throw new Error(`no target for ${ports.appUrl}`);
  return target;
}

async function connectTarget(target, commandTimeoutMs) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  await new Promise((resolveOpen, reject) => {
    ws.onopen = resolveOpen;
    ws.onerror = () => reject(new Error("failed to connect to Electron CDP"));
  });
  ws.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id) {
      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);
      clearTimeout(request.timeout);
      if (payload.error) request.reject(new Error(JSON.stringify(payload.error)));
      else request.resolve(payload.result);
      return;
    }
    for (const listener of listeners.get(payload.method) ?? []) listener(payload.params ?? {});
  });
  return {
    on(method, listener) {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
    },
    send(method, params = {}) {
      nextId += 1;
      const id = nextId;
      return new Promise((resolveRequest, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, commandTimeoutMs);
        pending.set(id, { resolve: resolveRequest, reject, timeout });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      return new Promise((resolveClose) => {
        if (ws.readyState === WebSocket.CLOSED) return resolveClose();
        ws.addEventListener("close", () => resolveClose(), { once: true });
        ws.close();
      });
    },
  };
}

async function evaluate(connection, expression, awaitPromise = false) {
  const response = await connection.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

async function screenshot(connection, path) {
  const response = await connection.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path, Buffer.from(response.data, "base64"));
}

async function waitForValue(read, predicate, label, timeoutMs) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(lastValue)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    child.kill("SIGINT");
  }
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      resolveStop();
    }, 7_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}
