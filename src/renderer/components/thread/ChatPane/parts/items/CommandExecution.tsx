import { memo, useMemo, useState } from "react";
import { Terminal } from "lucide-react";
import type { CommandExecutionPayload } from "@/shared/contracts";
import { stripAnsiPreservingLayout } from "@/shared/ansi";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { CommandOutputViewport } from "./CommandOutputViewport";
import { humanIntentTitle } from "./commandSummary";
import { extractAcpResultText, readAcpStringField } from "./acpToolPayload";

interface CommandExecutionProps {
  item: RuntimeChatItem;
}

export const CommandExecution = memo(function CommandExecution({ item }: CommandExecutionProps) {
  const payload = getRuntimeItemPayload<CommandExecutionPayload>(item, "command_execution");
  // ACP-sourced rows arrive without a streaming command_output; the actual
  // command lives under `args.command` (codex-shape rows already have it on
  // `payload.command`). Fall back so both shapes render the same title.
  const command =
    payload?.command && payload.command.length > 0
      ? payload.command
      : (readAcpStringField(payload, "command") ?? "");
  const cwd = payload?.cwd?.trim() ?? readAcpStringField(payload, "cwd")?.trim() ?? undefined;
  const isRunning = item.state !== "completed";
  const [isExpanded, setIsExpanded] = useState(false);
  const status = resolveCommandStatus(isRunning, payload?.exitCode, payload?.durationMs);
  const fullCommandLine = formatShellInvocation(cwd, command);
  const title = humanIntentTitle(fullCommandLine);

  const rawOutput = item.streams.command_output ?? "";
  const plainOutput = useMemo(() => {
    if (!isExpanded) return "";
    return stripAnsiPreservingLayout(rawOutput);
  }, [rawOutput, isExpanded]);

  // ACP rows ship the full command output as a single result blob — surface it
  // as the body when no streamed output exists.
  const acpResultText = isExpanded && plainOutput.length === 0 ? extractAcpResultText(payload) : "";

  const terminalBody = useMemo(
    () =>
      [
        fullCommandLine ? `$ ${fullCommandLine}` : "$ (command)",
        plainOutput.length > 0 ? plainOutput : acpResultText,
      ]
        .filter((p) => p.length > 0)
        .join("\n\n"),
    [fullCommandLine, plainOutput, acpResultText],
  );

  return (
    <ChatItemAccordion
      icon={<Terminal className="size-3" />}
      title={title}
      rightLabel={status.rightLabel}
      rightLabelClassName={status.textClass}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      {terminalBody.length > 0 ? <CommandOutputViewport text={terminalBody} /> : null}
    </ChatItemAccordion>
  );
});

type CommandStatus = { textClass: string; rightLabel: string };

function resolveCommandStatus(
  isRunning: boolean,
  exitCode: number | undefined,
  durationMs: number | undefined,
): CommandStatus {
  if (isRunning) {
    return { textClass: "!text-[color:var(--muted)]", rightLabel: "running" };
  }
  const dur = durationMs != null ? formatDuration(durationMs) : "";
  if (exitCode === undefined || exitCode === 0) {
    return { textClass: "!text-[color:var(--muted)]", rightLabel: dur };
  }
  return {
    textClass: "text-danger",
    rightLabel: dur,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatShellInvocation(cwd: string | undefined, command: string): string {
  const cmd = command.trim();
  if (!cmd) return "";
  if (cwd && cwd.length > 0) {
    const needsCd =
      !cmd.toLowerCase().startsWith("cd ") &&
      !/^(['"]).*\1\s+&&\s+/.test(cmd) &&
      !/^\(\s*cd\s/.test(cmd);
    if (needsCd) {
      const escaped = cwd.includes(" ") ? JSON.stringify(cwd) : cwd;
      return `cd ${escaped} && ${cmd}`;
    }
  }
  return cmd;
}
