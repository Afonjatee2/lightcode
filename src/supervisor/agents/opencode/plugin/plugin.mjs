/**
 * OpenCode plugin forwarder for Lightcode thread status.
 *
 * OpenCode imports plugin files in-process from `~/.config/opencode/plugins/`
 * and calls hook callbacks directly — unlike Claude/Codex/Gemini which spawn
 * `forward.mjs` per hook event. The handlers POST the same envelope shape the
 * other forwarders use so the hook ingress accepts events from every provider
 * via one endpoint.
 *
 * Safe outside Lightcode: when the env vars are missing the handlers no-op.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// Manifest is colocated with this file under two layouts:
//   1. Deployed in OpenCode's plugins/ dir → sibling `<basename>.plugin.json`
//      (we drop both files together so `import.meta.url` reaches them).
//      OpenCode only auto-loads `.{ts,js}` extensions, so the deployed file is
//      `lightcode-status.js`.
//   2. Staged in our agent-plugins/ dir → sibling `plugin.json` (matches
//      `installerBase`'s canonical filename, used by tests / dev paths). Here
//      the file is `plugin.mjs`. `extname`-based stem stripping handles both.
function readPluginVersionFromManifest() {
  try {
    const filePath = fileURLToPath(import.meta.url);
    const dir = dirname(filePath);
    const stem = basename(filePath, extname(filePath));
    for (const candidate of [`${stem}.plugin.json`, "plugin.json"]) {
      try {
        const raw = readFileSync(join(dir, candidate), "utf8");
        const manifest = JSON.parse(raw);
        if (typeof manifest.version === "string" && manifest.version.length > 0) {
          return manifest.version;
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // ignore
  }
  return "0.0.0";
}

const PLUGIN_VERSION = readPluginVersionFromManifest();
const PROTOCOL_VERSION = 1;

function hookDebugEnabled() {
  const v = process.env.LIGHTCODE_HOOK_DEBUG;
  return v === "1" || v === "true" || Boolean(v && v !== "0" && v !== "false");
}

function debugLog(message) {
  if (hookDebugEnabled()) {
    process.stderr.write(`[lightcode-opencode] ${message}\n`);
  }
}

function extractSessionId(input) {
  if (!input || typeof input !== "object") return undefined;
  const sid = input.sessionID ?? input.session_id ?? input.id ?? input?.session?.id;
  return typeof sid === "string" && sid.length > 0 ? sid : undefined;
}

// `tool.execute.after` / `permission.replied` are intentionally unmapped:
// noisy events and `session.idle` is the canonical turn-finished signal.
function intentForEvent(eventName) {
  switch (eventName) {
    case "session.created":
      return "session.started";
    case "tool.execute.before":
      return "session.turn_started";
    case "permission.asked":
      return "session.needs_approval";
    case "session.idle":
      return "session.turn_finished";
    case "session.error":
      return "session.turn_errored";
    default:
      return undefined;
  }
}

function buildExtra(eventName, input) {
  const extra = { agentNativeEvent: eventName };
  if (input && typeof input === "object") {
    if (typeof input.tool === "string") extra.tool = input.tool;
    if (typeof input.type === "string") extra.type = input.type;
    if (typeof input.message === "string") {
      extra.message =
        input.message.length > 500 ? `${input.message.slice(0, 500)}...` : input.message;
    }
  }
  return extra;
}

async function postWithRetry(url, headers, body, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { method: "POST", headers, body });
      if (response.ok || response.status === 426) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (i + 1 < attempts) await sleep(50);
  }
  if (lastError) {
    debugLog(`forward failed: ${String(lastError)}`);
  }
}

async function forwardEvent(eventName, input) {
  const url = process.env.LIGHTCODE_HOOK_URL;
  const secret = process.env.LIGHTCODE_HOOK_SECRET;
  const threadId = process.env.LIGHTCODE_THREAD_ID;
  const agentKind = process.env.LIGHTCODE_AGENT_KIND ?? "opencode";
  const supervisorProtocol = Number(
    process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? PROTOCOL_VERSION,
  );
  const negotiatedProtocol = Math.min(PROTOCOL_VERSION, supervisorProtocol || PROTOCOL_VERSION);

  if (!url || !secret) {
    debugLog(`skip ${eventName}: missing LIGHTCODE_HOOK_URL or LIGHTCODE_HOOK_SECRET`);
    return;
  }

  const intent = intentForEvent(eventName);
  if (!intent) {
    debugLog(`skip ${eventName}: no mapped intent`);
    return;
  }

  const sessionId = extractSessionId(input);
  const envelope = {
    protocolVersion: negotiatedProtocol,
    agentKind,
    pluginVersion: PLUGIN_VERSION,
    ts: Date.now(),
    intent,
    extra: buildExtra(eventName, input),
  };
  if (threadId) envelope.threadId = threadId;
  if (sessionId) envelope.sessionId = sessionId;

  await postWithRetry(
    url,
    {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    JSON.stringify(envelope),
  );

  debugLog(`posted intent=${intent} for ${eventName} sid=${sessionId ?? "-"}`);
}

function safeHandler(eventName) {
  return async (input) => {
    try {
      await forwardEvent(eventName, input);
    } catch (error) {
      debugLog(`${eventName} uncaught: ${String(error)}`);
    }
  };
}

export const LightcodeStatus = async () => ({
  "session.created": safeHandler("session.created"),
  "session.idle": safeHandler("session.idle"),
  "session.error": safeHandler("session.error"),
  "tool.execute.before": safeHandler("tool.execute.before"),
  "permission.asked": safeHandler("permission.asked"),
});

export default LightcodeStatus;
