#!/usr/bin/env node
/**
 * Codex CLI lifecycle hook forwarder for Lightcode.
 *
 * Invoked by Codex with:
 *   argv[2] = hook event name (e.g. "SessionStart", "Stop")
 *   stdin   = JSON payload (includes hook_event_name)
 *
 * Stop: Codex requires JSON on stdout when exit code is 0 — always emit `{}`.
 *
 * Cross-platform Node only. Intent mapping is inlined; pluginVersion from plugin.json.
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
    return `${s.slice(0, 2000)}… (${s.length} chars total)`;
  } catch {
    return String(payload);
  }
}

function intentFor(eventName, payload, debug) {
  const name = typeof payload?.hook_event_name === "string" ? payload.hook_event_name : eventName;
  switch (name) {
    case "SessionStart":
      return "session.started";
    case "UserPromptSubmit":
      return "session.turn_started";
    case "PermissionRequest":
      return "session.needs_approval";
    case "Stop":
      return "session.turn_finished";
    case "PreToolUse":
    case "PostToolUse":
      return debug ? "session.turn_started" : undefined;
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

function buildExtra(eventName, payload) {
  const extra = { agentNativeEvent: eventName };
  if (payload && typeof payload === "object") {
    if (typeof payload.session_id === "string") {
      extra.sessionId = payload.session_id;
    }
    if (typeof payload.turn_id === "string") {
      extra.turnId = payload.turn_id;
    }
    if (typeof payload.tool_name === "string") {
      extra.tool = payload.tool_name;
    }
    if (typeof payload.permission_mode === "string") {
      extra.permissionMode = payload.permission_mode;
    }
    if (payload.tool_input && typeof payload.tool_input === "object") {
      const cmd = payload.tool_input.command;
      if (typeof cmd === "string") {
        extra.toolCommand = cmd.length > 200 ? `${cmd.slice(0, 200)}…` : cmd;
      }
    }
    if (typeof payload.last_assistant_message === "string") {
      const m = payload.last_assistant_message;
      extra.lastAssistantMessage = m.length > 500 ? `${m.slice(0, 500)}…` : m;
    }
    if (typeof payload.stop_hook_active === "boolean") {
      extra.stopHookActive = payload.stop_hook_active;
    }
  }
  return extra;
}

async function main() {
  const eventName = process.argv[2];
  const isStop = eventName === "Stop";
  const debug = hookDebugEnabled();

  if (!eventName) {
    return;
  }

  const url = process.env.LIGHTCODE_HOOK_URL;
  const secret = process.env.LIGHTCODE_HOOK_SECRET;
  const threadId = process.env.LIGHTCODE_THREAD_ID;
  const agentKind = process.env.LIGHTCODE_AGENT_KIND ?? "codex";
  const supervisorProtocol = Number(
    process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? PROTOCOL_VERSION,
  );
  const negotiatedProtocol = Math.min(PROTOCOL_VERSION, supervisorProtocol || PROTOCOL_VERSION);

  const payload = await readStdin();
  const intent = intentFor(eventName, payload, debug);

  if (debug) {
    process.stderr.write(
      `[lightcode-hook] codex ${eventName} threadId=${threadId ?? "—"} sessionId=${
        typeof payload?.session_id === "string" ? payload.session_id : "—"
      } mappedIntent=${intent ?? "—"}\n`,
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
    if (isStop) {
      process.stdout.write("{}");
    }
  }
}

main().catch((error) => {
  if (hookDebugEnabled()) {
    process.stderr.write(`[lightcode-status] uncaught: ${String(error)}\n`);
  }
  if (process.argv[2] === "Stop") {
    process.stdout.write("{}");
  }
});
