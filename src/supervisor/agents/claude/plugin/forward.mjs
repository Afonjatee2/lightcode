#!/usr/bin/env node
/**
 * Claude Code lifecycle hook forwarder for Lightcode.
 *
 * Invoked by Claude on each subscribed hook event with:
 *   argv[2] = hook event name (e.g. "UserPromptSubmit")
 *   stdin   = JSON payload from Claude
 *
 * Reads `LIGHTCODE_HOOK_URL`, `LIGHTCODE_HOOK_SECRET`, etc. from env, builds
 * the universal Lightcode envelope, and POSTs it. Emits NOTHING on stdout —
 * Claude relays hook stdout into the model's context for some events.
 *
 * Cross-platform Node only — no shell, no native deps. The matching
 * `intentMap` is inlined here. `pluginVersion` in the POST body is read from
 * `plugin.json` in this same directory (staged next to this file).
 *
 * Debug: set `LIGHTCODE_HOOK_DEBUG=1` (or `true`) to log every invocation to
 * stderr — event name, mapped intent (or "—"), payload summary, and POST skips.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

function readPluginVersionFromManifest() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "plugin.json"), "utf8");
    const manifest = JSON.parse(raw);
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // missing manifest or bad JSON — still emit events with a safe fallback
  }
  return "0.0.0";
}

const PLUGIN_VERSION = readPluginVersionFromManifest();
const PROTOCOL_VERSION = 1;

function hookDebugEnabled() {
  const v = process.env.LIGHTCODE_HOOK_DEBUG;
  return v === "1" || v === "true" || Boolean(v && v !== "0" && v !== "false");
}

function summarizePayload(payload) {
  if (payload === undefined) {
    return "(empty stdin or unparseable JSON)";
  }
  try {
    const s = JSON.stringify(payload);
    if (s.length <= 2000) {
      return s;
    }
    return `${s.slice(0, 2000)}… (${s.length} chars total)`;
  } catch {
    return String(payload);
  }
}

function intentFor(eventName, payload) {
  switch (eventName) {
    case "SessionStart":
      return "session.started";
    case "UserPromptSubmit":
      return "session.turn_started";
    case "PermissionRequest":
      return "session.needs_approval";
    // Auto-mode classifier denied a tool. Claude usually recovers and
    // continues the turn, so we stay in `working` rather than idle.
    case "PermissionDenied":
      return "session.turn_started";
    // Tool finished (approve path) — exit `needs_approval`, still mid-turn.
    case "PostToolUse":
      return "session.turn_started";
    // Tool execution failed. Two sub-cases per Claude docs:
    //   - `is_interrupt: true` → user interrupt; `Stop` will NOT follow, so
    //     this is the actual turn end → idle.
    //   - otherwise → genuine failure; Claude recovers and `Stop` will fire,
    //     so stay `working` and let `Stop` close the turn.
    case "PostToolUseFailure":
      return payload?.is_interrupt === true ? "session.turn_finished" : "session.turn_started";
    case "ElicitationResult": {
      const a = payload?.action;
      if (a === "cancel" || a === "decline") {
        return "session.turn_finished";
      }
      return undefined;
    }
    case "Notification":
      return payload?.matcher === "idle_prompt" ? "session.needs_reply" : undefined;
    case "Stop":
      return "session.turn_finished";
    case "StopFailure":
      return "session.turn_errored";
    default:
      return undefined;
  }
}

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > 256 * 1024) break;
  }
  if (!data.trim()) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
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
  if (lastError && hookDebugEnabled()) {
    process.stderr.write(`[lightcode-status] forward failed: ${String(lastError)}\n`);
  }
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) return;

  const url = process.env.LIGHTCODE_HOOK_URL;
  const secret = process.env.LIGHTCODE_HOOK_SECRET;
  const threadId = process.env.LIGHTCODE_THREAD_ID;
  const agentKind = process.env.LIGHTCODE_AGENT_KIND ?? "claude";
  const supervisorProtocol = Number(
    process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? PROTOCOL_VERSION,
  );
  const negotiatedProtocol = Math.min(PROTOCOL_VERSION, supervisorProtocol || PROTOCOL_VERSION);

  const payload = await readStdin();
  const intent = intentFor(eventName, payload);

  if (hookDebugEnabled()) {
    process.stderr.write(
      `[lightcode-hook] ${eventName} threadId=${threadId ?? "—"} sessionId=${
        typeof payload?.session_id === "string" ? payload.session_id : "—"
      } mappedIntent=${intent ?? "—"}\n`,
    );
    process.stderr.write(`[lightcode-hook] payload ${summarizePayload(payload)}\n`);
  }

  if (!url || !secret) {
    if (hookDebugEnabled()) {
      process.stderr.write(
        "[lightcode-hook] skip POST: missing LIGHTCODE_HOOK_URL or LIGHTCODE_HOOK_SECRET\n",
      );
    }
    return;
  }

  if (!intent) {
    if (hookDebugEnabled()) {
      process.stderr.write(
        `[lightcode-hook] skip POST: no mapped Lightcode intent for ${eventName}\n`,
      );
    }
    return;
  }

  const sessionId = typeof payload?.session_id === "string" ? payload.session_id : undefined;

  const envelope = {
    protocolVersion: negotiatedProtocol,
    agentKind,
    pluginVersion: PLUGIN_VERSION,
    ts: Date.now(),
    intent,
    extra: {
      agentNativeEvent: eventName,
      ...(payload?.matcher ? { matcher: payload.matcher } : {}),
      ...(payload?.tool_name ? { tool: payload.tool_name } : {}),
      ...(payload?.message ? { message: payload.message } : {}),
    },
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

  if (hookDebugEnabled()) {
    process.stderr.write(`[lightcode-hook] posted intent=${intent} for ${eventName}\n`);
  }
}

main().catch((error) => {
  if (hookDebugEnabled()) {
    process.stderr.write(`[lightcode-status] uncaught: ${String(error)}\n`);
  }
});
