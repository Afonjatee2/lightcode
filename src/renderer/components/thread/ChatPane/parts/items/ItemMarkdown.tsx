import { Link } from "@heroui/react";
import { Suspense, lazy, useMemo } from "react";
import { readBridge } from "@/renderer/bridge";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatRelativePath } from "../../chatPathUtils";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";
import { parseProjectPathRef } from "./parseProjectPathRef";

const ItemMarkdownInner = lazy(() => import("./ItemMarkdownInner"));

interface ItemMarkdownProps {
  text: string;
}

/**
 * Compact markdown renderer used by every chat row (assistant, user,
 * reasoning). The heavy renderer (Streamdown + remark plugins) is lazy-loaded
 * so it doesn't block app startup; until the chunk arrives we fall back to a
 * plain-text view that still chips URLs and project paths so the first paint
 * is never blank.
 */
export function ItemMarkdown({ text }: ItemMarkdownProps) {
  const actions = useChatPaneActions();
  const rootNames = actions?.projectRootNames;
  return (
    <Suspense fallback={<PlainText text={text} rootNames={rootNames} />}>
      <ItemMarkdownInner text={text} />
    </Suspense>
  );
}

function PlainText({
  text,
  rootNames,
}: {
  text: string;
  rootNames: ReadonlySet<string> | undefined;
}) {
  const actions = useChatPaneActions();
  // Re-tokenizing on every render dominates the plain-text path during
  // streaming (regex scan over the full message body for each delta).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional escape hatch
  const nodes = useMemo(() => tokenizePlainText(text, rootNames), [text, rootNames]);
  return (
    <div className="whitespace-pre-wrap break-words text-[length:var(--lc-chat-font-size)] leading-snug text-foreground">
      {nodes.map((node, i) => {
        if (node.kind === "text") return <span key={i}>{node.value}</span>;
        if (node.kind === "url") {
          return (
            <Link
              key={i}
              href={node.href}
              rel="noreferrer noopener"
              className="[display:inline] [width:auto] [overflow-wrap:anywhere] [word-break:break-word]"
              onClick={(event) => {
                event.preventDefault();
                void readBridge().openExternal(node.href);
              }}
            >
              {node.href}
            </Link>
          );
        }
        if (node.kind === "file") {
          return (
            <InlineFilePathChip
              key={i}
              path={normalizeChatRelativePath(node.path)}
              line={node.line}
              onOpen={actions?.openProjectRelativePath}
            />
          );
        }
        return (
          <InlineFolderPathChip
            key={i}
            path={normalizeChatRelativePath(node.path)}
            onRevealInTree={actions?.revealProjectFolderInTree}
            onShowInExplorer={actions?.showProjectEntryInExplorer}
          />
        );
      })}
    </div>
  );
}

type PlainTextNode =
  | { kind: "text"; value: string }
  | { kind: "url"; href: string }
  | { kind: "file"; path: string; line?: number }
  | { kind: "folder"; path: string };

const PLAIN_TOKEN_RE =
  /https?:\/\/[^\s<>"']+|(?<![A-Za-z0-9_:/@.\\-])([A-Za-z0-9_@.][A-Za-z0-9_@.-]*(?:[\\/][A-Za-z0-9_@.-]+)+)(?::(\d+))?/g;

function tokenizePlainText(
  text: string,
  rootNames: ReadonlySet<string> | undefined,
): PlainTextNode[] {
  PLAIN_TOKEN_RE.lastIndex = 0;
  const out: PlainTextNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = PLAIN_TOKEN_RE.exec(text)) !== null) {
    if (/^https?:\/\//i.test(match[0])) {
      const href = trimTrailingUrlPunctuation(match[0]);
      if (href.length === 0) continue;
      if (match.index > cursor) {
        out.push({ kind: "text", value: text.slice(cursor, match.index) });
      }
      out.push({ kind: "url", href });
      cursor = match.index + href.length;
      PLAIN_TOKEN_RE.lastIndex = cursor;
      continue;
    }

    const ref = parseProjectPathRef(match[0], { rootNames });
    if (!ref) continue;
    if (match.index > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    if (ref.kind === "file") {
      out.push(
        ref.line !== undefined
          ? { kind: "file", path: ref.path, line: ref.line }
          : { kind: "file", path: ref.path },
      );
    } else {
      out.push({ kind: "folder", path: ref.path });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor === 0) return [{ kind: "text", value: text }];
  if (cursor < text.length) out.push({ kind: "text", value: text.slice(cursor) });
  return out;
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/, "");
}

export function normalizeShortCodeFenceClosers(text: string): string {
  let inBacktickFence = false;
  let changed = false;
  const out = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.map((line) => {
    if (line.length === 0) return line;
    const newlineMatch = line.match(/(\r\n|\n|\r)$/);
    const newline = newlineMatch?.[0] ?? "";
    const body = newline ? line.slice(0, -newline.length) : line;
    if (!inBacktickFence) {
      if (/^ {0,3}```[^`]*$/.test(body)) inBacktickFence = true;
      return line;
    }
    if (/^ {0,3}```+\s*$/.test(body)) {
      inBacktickFence = false;
      return line;
    }
    const shortCloserMatch = body.match(/^( {0,3})``\s*$/);
    if (!shortCloserMatch) return line;
    inBacktickFence = false;
    changed = true;
    return `${shortCloserMatch[1]}\`\`\`${newline}`;
  });
  return changed ? (out ?? []).join("") : text;
}
