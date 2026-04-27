#!/usr/bin/env node
/**
 * Gemini CLI lifecycle hook forwarder for Lightcode.
 *
 * Gemini hooks communicate via JSON stdin/stdout. This script writes only a
 * final JSON object to stdout, and sends diagnostics to stderr when
 * LIGHTCODE_HOOK_DEBUG is enabled.
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

function summarizePayload(payload) {
  if (payload === undefined) {
    return "(empty stdin or unparseable JSON)";
  }
  try {
    const s = JSON.stringify(payload);
    if (s.length <= 2000) {
      return s;
    }
    return `${s.slice(0, 2000)}... (${s.length} chars total)`;
  } catch {
    return String(payload);
  }
}

function notificationNeedsApproval(payload) {
  const notificationType = `${payload?.notification_type ?? payload?.type ?? ""}`.toLowerCase();
  const message = `${payload?.message ?? ""}`.toLowerCase();
  return (
    notificationType === "toolpermission" ||
    notificationType.includes("permission") ||
    message.includes("permission") ||
    message.includes("approval")
  );
}

function intentFor(eventName, payload) {
  const name = typeof payload?.hook_event_name === "string" ? payload.hook_event_name : eventName;
  switch (name) {
    case "SessionStart":
      return "session.started";
    case "BeforeAgent":
    case "BeforeModel":
    case "BeforeTool":
    case "AfterTool":
      return "session.turn_started";
    case "AfterAgent":
      return "session.turn_finished";
    case "Notification":
      return notificationNeedsApproval(payload) ? "session.needs_approval" : undefined;
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

function copyStringExtra(extra, payload, sourceKey, targetKey, max = 500) {
  const v = payload?.[sourceKey];
  if (typeof v !== "string" || v.length === 0) return;
  extra[targetKey] = v.length > max ? `${v.slice(0, max)}...` : v;
}

function buildExtra(eventName, payload) {
  const extra = { agentNativeEvent: eventName };
  if (payload && typeof payload === "object") {
    copyStringExtra(extra, payload, "hook_event_name", "hookEventName");
    copyStringExtra(extra, payload, "source", "source");
    copyStringExtra(extra, payload, "tool_name", "tool");
    copyStringExtra(extra, payload, "original_request_name", "originalRequestName");
    copyStringExtra(extra, payload, "notification_type", "notificationType");
    copyStringExtra(extra, payload, "message", "message");
    if (payload.details && typeof payload.details === "object") {
      extra.details = payload.details;
    }
    if (typeof payload.stop_hook_active === "boolean") {
      extra.stopHookActive = payload.stop_hook_active;
    }
  }
  return extra;
}

async function main() {
  const eventName = process.argv[2];
  if (!eventName) return;

  const debug = hookDebugEnabled();
  const url = process.env.LIGHTCODE_HOOK_URL;
  const secret = process.env.LIGHTCODE_HOOK_SECRET;
  const threadId = process.env.LIGHTCODE_THREAD_ID;
  const agentKind = process.env.LIGHTCODE_AGENT_KIND ?? "gemini";
  const supervisorProtocol = Number(
    process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? PROTOCOL_VERSION,
  );
  const negotiatedProtocol = Math.min(PROTOCOL_VERSION, supervisorProtocol || PROTOCOL_VERSION);

  const payload = await readStdin();
  const intent = intentFor(eventName, payload);

  if (debug) {
    process.stderr.write(
      `[lightcode-hook] gemini ${eventName} threadId=${threadId ?? "-"} sessionId=${
        typeof payload?.session_id === "string" ? payload.session_id : "-"
      } mappedIntent=${intent ?? "-"}\n`,
    );
    process.stderr.write(`[lightcode-hook] payload ${summarizePayload(payload)}\n`);
  }

  try {
    if (!url || !secret) {
      if (debug) {
        process.stderr.write(
          "[lightcode-hook] skip POST: missing LIGHTCODE_HOOK_URL or LIGHTCODE_HOOK_SECRET\n",
        );
      }
      return;
    }

    if (!intent) {
      if (debug) {
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
      extra: buildExtra(eventName, payload),
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

    if (debug) {
      process.stderr.write(`[lightcode-hook] posted intent=${intent} for ${eventName}\n`);
    }
  } finally {
    process.stdout.write('{"suppressOutput":true}\n');
  }
}

main().catch((error) => {
  if (hookDebugEnabled()) {
    process.stderr.write(`[lightcode-status] uncaught: ${String(error)}\n`);
  }
  process.stdout.write('{"suppressOutput":true}\n');
});
