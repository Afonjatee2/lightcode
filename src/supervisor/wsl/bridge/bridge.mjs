#!/usr/bin/env node
/**
 * Lightcode CLI hook bridge — runs INSIDE a WSL distro.
 *
 * The supervisor on Windows can't be reached at `127.0.0.1:<port>` from
 * inside WSL2 NAT mode because that loopback resolves to the WSL VM, not
 * the Windows host. Instead, the supervisor stages this script under
 * `~/.lightcode/bridge/bridge.mjs` and spawns it via `wsl.exe`. The bridge
 * binds `127.0.0.1:0` *inside* the distro so plugins (e.g. Claude's
 * `forward.mjs`) can POST to it locally, and forwards every accepted
 * envelope to the supervisor over its own stdout as JSONL.
 *
 * Wire format on stdout:
 *   {"type":"boot","port":<n>,"protocolVersion":<n>,"version":"<x>"}\n once
 *   {"type":"event","payload":<envelope>}\n                       per event
 *   {"type":"error","message":"…"}\n                              optional
 *
 * The script intentionally has no `import`s beyond `node:*` and avoids any
 * filesystem writes — it is restartable, stateless, and trivially audited.
 *
 * The `version` field in `boot` is consumed by the Windows-side
 * `WslHookBridgeManager` to detect stale copies left over from a previous
 * app version. If the Windows side's bundled version differs, it will
 * restage+respawn once. Bump on every behavioural change to the wire
 * format or HTTP endpoint so rollouts are observable in logs.
 */

import { createServer } from "node:http";

// Bumped when bridge.mjs changes. Windows side reads this same constant
// via regex to decide whether a running bridge needs to be restarted.
const BRIDGE_VERSION = "1.0.0";

const PROTOCOL_VERSION = Number(process.env.LIGHTCODE_HOOK_PROTOCOL_VERSION ?? "1") || 1;
const SECRET = process.env.LIGHTCODE_HOOK_SECRET;
const HOOK_PATH = "/v1/agent-event";
const MAX_BODY_BYTES = 64 * 1024;
const VALID_INTENTS = new Set([
  "session.started",
  "session.turn_started",
  "session.needs_approval",
  "session.needs_reply",
  "session.turn_finished",
  "session.turn_errored",
]);

if (!SECRET) {
  emit({ type: "error", message: "LIGHTCODE_HOOK_SECRET missing in bridge env" });
  process.exit(2);
}

function emit(message) {
  // Always one JSON object per line, never partial writes (Node.js stdout
  // is line-buffered when piped, but we flush manually to be safe).
  process.stdout.write(JSON.stringify(message) + "\n");
}

function respond(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let oversized = false;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (oversized) return;
      if (total > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) {
        reject(new Error("payload_too_large"));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function validateEnvelope(json) {
  if (!json || typeof json !== "object") return null;
  const protocolVersion = json.protocolVersion;
  const agentKind = json.agentKind;
  const pluginVersion = json.pluginVersion;
  const ts = json.ts;
  const intent = json.intent;
  if (
    typeof protocolVersion !== "number" ||
    !Number.isInteger(protocolVersion) ||
    protocolVersion < 1
  )
    return null;
  if (typeof agentKind !== "string" || agentKind.length === 0) return null;
  if (typeof pluginVersion !== "string" || pluginVersion.length === 0) return null;
  if (typeof ts !== "number" || !Number.isInteger(ts) || ts < 0) return null;
  if (typeof intent !== "string" || !VALID_INTENTS.has(intent)) return null;
  const threadId =
    typeof json.threadId === "string" && json.threadId.length > 0 ? json.threadId : undefined;
  const sessionId =
    typeof json.sessionId === "string" && json.sessionId.length > 0 ? json.sessionId : undefined;
  if (!threadId && !sessionId) return null;
  return json;
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    respond(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!req.url || !req.url.startsWith(HOOK_PATH)) {
    respond(res, 404, { error: "not_found" });
    return;
  }
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || auth !== `Bearer ${SECRET}`) {
    respond(res, 401, { error: "unauthorized" });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    respond(res, 413, { error: "payload_too_large" });
    return;
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    respond(res, 400, { error: "invalid_json" });
    return;
  }

  const rawProtocol = json && typeof json === "object" ? json.protocolVersion : undefined;
  if (typeof rawProtocol === "number" && rawProtocol < 1) {
    respond(res, 426, {
      error: "upgrade_required",
      supportedProtocol: PROTOCOL_VERSION,
      minProtocol: 1,
    });
    return;
  }

  const envelope = validateEnvelope(json);
  if (!envelope) {
    respond(res, 400, { error: "invalid_envelope" });
    return;
  }

  if (envelope.protocolVersion > PROTOCOL_VERSION) {
    respond(res, 200, { ok: true, downgraded: true, supportedProtocol: PROTOCOL_VERSION });
  } else {
    respond(res, 202, { ok: true });
  }

  emit({ type: "event", payload: envelope });
});

server.on("error", (error) => {
  emit({ type: "error", message: String(error?.message ?? error) });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    emit({ type: "error", message: "unexpected listen address" });
    process.exit(2);
    return;
  }
  emit({
    type: "boot",
    port: address.port,
    protocolVersion: PROTOCOL_VERSION,
    version: BRIDGE_VERSION,
  });
});

function shutdown() {
  server.close(() => process.exit(0));
  // Hard-stop fallback in case close() hangs on a stuck socket.
  setTimeout(() => process.exit(0), 250).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
