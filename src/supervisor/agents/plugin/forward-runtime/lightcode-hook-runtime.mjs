/**
 * Shared runtime for provider hook forwarders (claude/codex/gemini/copilot/cursor).
 *
 * Each provider's `forward.mjs` imports this file as a sibling and calls
 * `runForwarder({ agentKind, intentFor, buildExtra, pickSessionId, ... })`.
 * The runtime owns: manifest read for `pluginVersion`, env-var debug flag,
 * stdin read with 256KB cap, retry POST, envelope construction, debug
 * logging, and the always-emit-stdout-on-error contract some CLIs require.
 *
 * Standalone ESM: must run under user CLI Node (claude / codex / cursor /
 * etc) without a bundler. Cross-platform — no shell, no native deps.
 *
 * Shipped via `prepare-agent-plugins.mjs` into each provider's plugin dir at
 * staging time, so `import "./lightcode-hook-runtime.mjs"` resolves as a
 * sibling of `forward.mjs` inside `~/.lightcode/agent-plugins/<kind>/`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const PROTOCOL_VERSION = 1;

export function readPluginVersionFromManifest(importMetaUrl) {
  try {
    const dir = dirname(fileURLToPath(importMetaUrl));
    const raw = readFileSync(join(dir, "plugin.json"), "utf8");
    const manifest = JSON.parse(raw);
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // missing manifest or bad JSON — emit events with the safe fallback
  }
  return "0.0.0";
}

export function hookDebugEnabled() {
  const v = process.env.LIGHTCODE_HOOK_DEBUG;
  return v === "1" || v === "true" || Boolean(v && v !== "0" && v !== "false");
}

export function summarizePayload(payload) {
  if (payload === undefined) return "(empty stdin or unparseable JSON)";
  try {
    const s = JSON.stringify(payload);
    return s.length <= 2000 ? s : `${s.slice(0, 2000)}... (${s.length} chars total)`;
  } catch {
    return String(payload);
  }
}

export async function readStdin() {
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

export async function postWithRetry(url, headers, body, attempts = 2) {
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

/** Convenience helper for `buildExtra` impls — copies a string field with truncation. */
export function copyStringExtra(extra, payload, sourceKey, targetKey, max = 500) {
  const v = payload?.[sourceKey];
  if (typeof v !== "string" || v.length === 0) return;
  extra[targetKey] = v.length > max ? `${v.slice(0, max)}...` : v;
}

/**
 * Run a provider forwarder. Reads argv[2] as the event name, JSON stdin as
 * payload, builds the universal envelope, and POSTs it. Returns silently when
 * the env vars are absent (i.e. the agent is running outside Lightcode) or
 * when the provider can't map the event to an intent.
 *
 * Options:
 *   - `agentKind`           default for the `agentKind` envelope field, used
 *                           when `LIGHTCODE_AGENT_KIND` env var is unset.
 *   - `pluginVersion`       provider's plugin.json version (string).
 *   - `intentFor(name, payload, ctx)` map a native event to a Lightcode
 *                           intent. `ctx.debug` available for per-event debug
 *                           tweaks (see codex). Return `undefined` to skip.
 *   - `buildExtra(name, payload)` provider-specific `extra` object.
 *   - `pickSessionId(payload)` extract the agent session id, or undefined.
 *   - `stdoutResponseFor(eventName)?` if returns a non-empty string, the
 *                           runtime writes it to stdout — even on uncaught
 *                           errors. Used by codex (Stop="{}") and gemini
 *                           ('{"suppressOutput":true}\n'); cursor passes a
 *                           variant that always returns a value.
 *   - `debugLabel`          tag for `[lightcode-hook] <label>` debug lines.
 *                           Defaults to `agentKind`.
 */
export async function runForwarder(options) {
  const {
    agentKind: defaultAgentKind,
    pluginVersion,
    intentFor,
    buildExtra,
    pickSessionId,
    stdoutResponseFor,
    debugLabel,
  } = options;

  const eventName = process.argv[2] ?? "";

  try {
    if (!eventName) return;

    const debug = hookDebugEnabled();
    const url = process.env.LIGHTCODE_HOOK_URL;
    const secret = process.env.LIGHTCODE_HOOK_SECRET;
    const threadId = process.env.LIGHTCODE_THREAD_ID;
    const agentKind = process.env.LIGHTCODE_AGENT_KIND ?? defaultAgentKind;
    const supervisorProtocol = Number(
      process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? PROTOCOL_VERSION,
    );
    const negotiatedProtocol = Math.min(PROTOCOL_VERSION, supervisorProtocol || PROTOCOL_VERSION);

    const payload = await readStdin();
    const intent = intentFor(eventName, payload, { debug });
    const sessionId = pickSessionId(payload);
    const label = debugLabel ?? agentKind;

    if (debug) {
      process.stderr.write(
        `[lightcode-hook] ${label} ${eventName} threadId=${threadId ?? "-"} sessionId=${
          sessionId ?? "-"
        } mappedIntent=${intent ?? "-"}\n`,
      );
      process.stderr.write(`[lightcode-hook] payload ${summarizePayload(payload)}\n`);
    }

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

    const envelope = {
      protocolVersion: negotiatedProtocol,
      agentKind,
      pluginVersion,
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
  } catch (error) {
    if (hookDebugEnabled()) {
      process.stderr.write(`[lightcode-status] uncaught: ${String(error)}\n`);
    }
  } finally {
    if (stdoutResponseFor) {
      const out = stdoutResponseFor(eventName);
      if (typeof out === "string" && out.length > 0) process.stdout.write(out);
    }
  }
}
