import { memo, useMemo, useState } from "react";
import { FileEdit } from "lucide-react";
import type { FileChangePayload } from "@/shared/contracts";
import { PathDisplay } from "@/renderer/components/common";
import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import { ChatItemAccordion } from "./ChatItemAccordion";
import { CommandOutputViewport } from "./CommandOutputViewport";
import { ToolCallSections, type ToolCallSection } from "./ToolCallSections";
import { extractAcpArgsPart, extractAcpResultPart, type ExtractedPart } from "./acpToolPayload";
import { detectLanguageFromPath } from "./languageDetect";

interface FileChangeProps {
  item: RuntimeChatItem;
}

export const FileChange = memo(function FileChange({ item }: FileChangeProps) {
  const payload = getRuntimeItemPayload<FileChangePayload>(item, "file_change");
  const [isExpanded, setIsExpanded] = useState(false);
  const stream = item.streams.file_change_output;
  const sections = useMemo<ToolCallSection[]>(() => {
    if (!isExpanded || !payload || (stream && stream.length > 0)) return [];
    const argsPart = extractAcpArgsPart(payload);
    const resultPart = extractAcpResultPart(payload);
    const path = payload.path;
    return [
      { label: "args", part: enrichLanguage(argsPart, path) },
      { label: "result", part: resultPart },
    ];
  }, [isExpanded, payload, stream]);
  if (!payload?.path) return null;
  const right = formatRightLabel(payload);
  const hasDetails = (stream && stream.length > 0) || hasAuxFields(payload);

  return (
    <ChatItemAccordion
      icon={<FileEdit className="size-3" />}
      title={
        <PathDisplay
          path={payload.path}
          basenameClassName="!text-[color:var(--foreground)]"
          dirClassName="!text-[color:var(--muted)]"
        />
      }
      rightLabel={right}
      hasBody={hasDetails}
      isExpanded={isExpanded}
      onExpandedChange={setIsExpanded}
    >
      {stream && stream.length > 0 ? (
        <CommandOutputViewport text={stream} language={detectLanguageFromPath(payload.path)} />
      ) : (
        <ToolCallSections sections={sections} />
      )}
    </ChatItemAccordion>
  );
});

function hasAuxFields(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p.args !== undefined || p.result !== undefined;
}

/**
 * Prefer the language detected from the file path over the structural guess
 * — `apply_patch` args for `foo.ts` should render as TypeScript, not plain.
 * Falls back to whatever `extractAcpArgsPart` decided when the path has no
 * recognized extension.
 */
function enrichLanguage(part: ExtractedPart, path: string): ExtractedPart {
  const detected = detectLanguageFromPath(path);
  if (detected !== "plain") return { ...part, language: detected };
  return part;
}

function formatRightLabel(payload: FileChangePayload): string {
  const parts: string[] = [payload.changeKind];
  if (payload.diffSummary) {
    parts.push(`+${payload.diffSummary.added} -${payload.diffSummary.removed}`);
  }
  return parts.join(" · ");
}
