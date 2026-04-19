import { randomUUID } from "node:crypto";

import type { PromptSegment } from "@/shared/contracts";
import { createAcpStructuredSession } from "../acp";
import {
  applyTerminalHintToConfig,
  createKnownSessionRef,
  detectAgentInstall,
  type AgentAdapter,
  type CreateStructuredSessionInput,
} from "../base";
import { resolveAgentBinaryPath } from "../binaryResolver";
import { buildCopilotArgs, formatCopilotInteractivePrompt } from "./argv";
import { buildCopilotCommand, copilotDefaultCapabilities, copilotDetectionSpec } from "./detection";
import {
  detectCopilotInvalidSessionRef,
  detectCopilotTerminalStatus,
  READY_RE,
  resolveModelId,
} from "./terminal";

export {
  detectCopilotInvalidSessionRef,
  detectCopilotModelEffort,
  detectCopilotStatusLineModel,
  detectCopilotTerminalStatus,
} from "./terminal";

export function createCopilotAdapter(): AgentAdapter {
  let capabilities = copilotDefaultCapabilities;

  return {
    kind: "copilot",
    label: "GitHub Copilot",
    get capabilities() {
      return capabilities;
    },
    spawnEnv: { wsl: { BROWSER: "/bin/true" } },
    async detectInstall(ctx) {
      const status = await detectAgentInstall(ctx, copilotDetectionSpec);
      capabilities = status.capabilities;
      return status;
    },
    buildLaunchArgv(_location, config, prompt, _sessionRef, launchOptions) {
      const sessionId = launchOptions?.resumeThreadId ?? randomUUID();
      return {
        binary: "copilot",
        args: buildCopilotArgs(config, prompt, sessionId, launchOptions),
        sessionRef: createKnownSessionRef(sessionId),
      };
    },
    buildResumeArgv(_location, config, prompt, sessionRef, launchOptions) {
      return {
        binary: "copilot",
        args: buildCopilotArgs(
          config,
          prompt,
          launchOptions?.resumeThreadId ?? sessionRef.providerSessionId,
          launchOptions,
        ),
      };
    },
    async createStructuredSession(input: CreateStructuredSessionInput) {
      if (input.sessionRef) {
        return undefined;
      }

      const args = ["--acp", "--stdio"];
      if (input.config.approvalPolicy === "never") {
        args.push("--yolo");
      }
      const command = buildCopilotCommand(
        input.projectLocation,
        args,
        resolveAgentBinaryPath(input.projectLocation, "copilot"),
      );
      return createAcpStructuredSession(command, input);
    },
    createInitialSessionRef() {
      return undefined;
    },
    buildDirectInput(prompt, _segments, config) {
      return [formatCopilotInteractivePrompt(prompt, config), "@wait:40", "\r"];
    },
    formatPromptSegments(segments: PromptSegment[]) {
      const attachments = segments.filter((segment) => segment.kind === "attachment");
      const rest = segments.filter((segment) => segment.kind !== "attachment");
      const attachmentLines = attachments.map((segment) => `@${segment.path}`).join(" ");
      const restStr = rest
        .map((segment) => (segment.kind === "file" ? `@${segment.path}` : segment.content))
        .join("");
      return attachmentLines ? `${restStr}\n\n${attachmentLines} ` : restStr;
    },
    isReadyForInitialPrompt(text) {
      return READY_RE.test(text);
    },
    detectTerminalStatus(text) {
      const hint = detectCopilotTerminalStatus(text);
      if (hint?.model) {
        hint.model = resolveModelId(hint.model, capabilities.models);
      }
      return hint;
    },
    detectInvalidSessionRef(text) {
      return detectCopilotInvalidSessionRef(text);
    },
    syncConfigFromTerminalState: applyTerminalHintToConfig,
    defaultOneShotModel: "",
    buildOneShotCommand(model, effort, prompt) {
      if (!prompt) {
        return undefined;
      }

      const args = ["-p", prompt, "-s", "--allow-all-tools"];
      if (model) {
        args.push("--model", model);
      }
      if (effort) {
        args.push("--effort", effort);
      }

      return { command: "copilot", args, stdin: "" };
    },
    buildContextExtractionCommand(sessionRef, _location, model) {
      // Copilot's -p flag takes the prompt inline as an arg.
      // The orchestrator pipes the extraction prompt via stdin,
      // so we pass a brief directive via -p and let stdin carry the full prompt.
      const args = [
        "-p",
        "Summarize this conversation for handoff to another AI assistant. Reply with only the summary.",
        `--resume=${sessionRef.providerSessionId}`,
        "-s",
        "--allow-all-tools",
      ];
      if (model) {
        args.push("--model", model);
      }
      return { command: "copilot", args, stdin: "" };
    },
  };
}
