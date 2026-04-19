import type { AgentCapability, PromptSegment } from "@/shared/contracts";
import { createKnownSessionRef, detectAgentInstall, type AgentAdapter } from "../base";
import { buildCursorArgs } from "./argv";
import { cursorDefaultCapabilities, cursorDetectionSpec } from "./detection";
import { createCursorChatSync } from "./session";
import { CURSOR_IDLE_RE, CURSOR_WORKING_RE, detectCursorTerminalStatus } from "./terminal";

export { buildCursorProbeSpec, parseCursorModels, sortCursorModels } from "./detection";
export { detectCursorTerminalStatus } from "./terminal";

export function createCursorAdapter(): AgentAdapter {
  let capabilities: AgentCapability = cursorDefaultCapabilities;

  return {
    kind: "cursor",
    label: "Cursor CLI",
    get capabilities() {
      return capabilities;
    },
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },
    detectInstall: async (ctx) => {
      const status = await detectAgentInstall(ctx, cursorDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv(location, config, prompt) {
      const chatId = createCursorChatSync(location);
      const args = buildCursorArgs(config, prompt, chatId);
      return {
        binary: "cursor-agent",
        args,
        ...(chatId ? { sessionRef: createKnownSessionRef(chatId) } : {}),
      };
    },
    buildResumeArgv(_location, config, prompt, sessionRef) {
      const args = buildCursorArgs(config, prompt, sessionRef.providerSessionId);
      return { binary: "cursor-agent", args };
    },
    createInitialSessionRef() {
      return undefined;
    },
    buildDirectInput(prompt) {
      return [prompt, "@wait:40", "\r"];
    },
    formatPromptSegments(segments: PromptSegment[]) {
      const attachments = segments.filter((s) => s.kind === "attachment");
      const rest = segments.filter((s) => s.kind !== "attachment");
      const attachmentLines = attachments.map((s) => `@${s.path}`).join(" ");
      const restStr = rest.map((s) => (s.kind === "file" ? `@${s.path}` : s.content)).join("");
      return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
    },
    isReadyForInitialPrompt(text) {
      return CURSOR_IDLE_RE.test(text) && !CURSOR_WORKING_RE.test(text);
    },
    detectTerminalStatus(text) {
      return detectCursorTerminalStatus(text);
    },
    defaultOneShotModel: "composer-2-fast",
    buildOneShotCommand(model) {
      const args = ["--print", "--force", "--trust", "--output-format", "json"];
      if (model && model !== "auto") {
        args.push("--model", model);
      }
      return { command: "cursor-agent", args };
    },
    buildContextExtractionCommand(sessionRef, _location, model) {
      const args = [
        "--print",
        "--force",
        "--trust",
        `--resume=${sessionRef.providerSessionId}`,
        "--output-format",
        "json",
      ];
      if (model && model !== "auto") {
        args.push("--model", model);
      }
      return { command: "cursor-agent", args };
    },
  };
}
