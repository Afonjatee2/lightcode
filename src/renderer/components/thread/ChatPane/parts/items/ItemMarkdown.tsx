import { Link, Table } from "@heroui/react";
import {
  Children,
  isValidElement,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readBridge } from "@/renderer/bridge";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatRelativePath } from "../../chatPathUtils";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";
import { parseProjectPathRef, type ProjectPathRef } from "./parseProjectPathRef";
import {
  AUTO_PATH_FILE_PREFIX,
  AUTO_PATH_FOLDER_PREFIX,
  remarkAutolinkProjectPaths,
} from "./remarkAutolinkProjectPaths";

interface ItemMarkdownProps {
  text: string;
  mode?: "markdown" | "plain";
}

type RemarkPlugins = ComponentProps<typeof ReactMarkdown>["remarkPlugins"];

/**
 * Compact markdown renderer used by chat rows.
 *
 * Inline `` `code` `` from markdown (CommonMark) is rendered as a subtle chip;
 * spans that look like project paths become accent buttons that open the editor
 * when the pane provides `ChatPaneActions`. Plain-text path tokens in markdown
 * prose are auto-detected and chipped as well, gated on the project's
 * top-level entry names so unrelated `@scope/name` packages don't match.
 */
export function ItemMarkdown({ text, mode = "markdown" }: ItemMarkdownProps) {
  const actions = useChatPaneActions();
  const rootNames = actions?.projectRootNames;

  if (mode === "plain") {
    return <PlainText text={text} rootNames={rootNames} />;
  }
  // Escape the React Compiler: the plugin tuple contains a closure that
  // captures `rootNames`, which the compiler conservatively re-creates on
  // every render. Streaming chats re-render this component on every chunk,
  // so we anchor the array to `rootNames` identity so ReactMarkdown sees a
  // stable plugin reference.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional escape hatch (see comment above)
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
      remarkGfm,
      [
        remarkAutolinkProjectPaths,
        { parsePathRef: (token: string) => parseProjectPathRef(token, { rootNames }) },
      ],
    ],
    [rootNames],
  );
  const markdownText = normalizeShortCodeFenceClosers(text);
  return (
    <div className="lc-chat-markdown prose max-w-none text-[length:var(--lc-chat-font-size)] leading-snug text-foreground prose-headings:text-[length:var(--lc-chat-font-size)] prose-p:text-[length:var(--lc-chat-font-size)] prose-li:text-[length:var(--lc-chat-font-size)] prose-pre:my-2 prose-pre:rounded prose-pre:border-0 prose-pre:bg-foreground/10 prose-pre:px-[0.5em] prose-pre:py-[0.25em] prose-pre:font-mono prose-pre:text-[0.875em] prose-pre:leading-snug prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:underline prose-a:underline-offset-2">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={MD_COMPONENTS}>
        {markdownText}
      </ReactMarkdown>
    </div>
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
  // Memoize on `(text, rootNames)` so an unchanged message in a re-rendered
  // parent skips the scan entirely.
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

const MD_COMPONENTS: Components = {
  code({ className, children }) {
    return <MdCode className={className ?? ""}>{children}</MdCode>;
  },
  a({ href, children }) {
    return <MdAnchor href={href ?? ""}>{children}</MdAnchor>;
  },
  table({ children }) {
    return <MdTable>{children}</MdTable>;
  },
};

const inlineCodeChipClass =
  "rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-foreground [overflow-wrap:anywhere]";

function MdCode(props: { className: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const isBlock = typeof props.className === "string" && props.className.includes("language-");
  const text = flattenMdChildren(props.children).replace(/\n$/, "");
  if (isBlock) {
    return <code className={props.className || undefined}>{props.children}</code>;
  }
  if (actions) {
    const ref = parseProjectPathRef(text, { rootNames: actions.projectRootNames });
    if (ref) {
      return renderPathChip(ref, actions);
    }
  }
  return <code className={inlineCodeChipClass}>{props.children}</code>;
}

function MdAnchor(props: { href: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const href = props.href?.trim() ?? "";
  if (!href) return <span>{props.children}</span>;

  // Links injected by the auto-path remark plugin always render as chips so
  // plain-text paths and inline-code paths share a single visual treatment.
  if (actions && href.startsWith(AUTO_PATH_FILE_PREFIX)) {
    const rest = href.slice(AUTO_PATH_FILE_PREFIX.length);
    const lineMatch = rest.match(/^(.+):(\d+)$/);
    const path = lineMatch ? lineMatch[1]! : rest;
    const ref: ProjectPathRef = lineMatch
      ? { kind: "file", path, line: Number.parseInt(lineMatch[2]!, 10) }
      : { kind: "file", path };
    return renderPathChip(ref, actions);
  }
  if (actions && href.startsWith(AUTO_PATH_FOLDER_PREFIX)) {
    const path = href.slice(AUTO_PATH_FOLDER_PREFIX.length);
    return renderPathChip({ kind: "folder", path }, actions);
  }

  if (/^(https?|mailto):/i.test(href)) {
    return (
      <Link
        href={href}
        rel="noreferrer noopener"
        className="[display:inline] [width:auto] [overflow-wrap:anywhere] [word-break:break-word]"
        onClick={(event) => {
          event.preventDefault();
          void readBridge().openExternal(href);
        }}
      >
        {props.children}
      </Link>
    );
  }
  if (actions) {
    const ref = parseProjectPathRef(href, { rootNames: actions.projectRootNames });
    if (ref?.kind === "folder") {
      const folderPath = normalizeChatRelativePath(ref.path);
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-accent underline-offset-2 [overflow-wrap:anywhere] hover:bg-foreground/15 hover:underline"
          onClick={() => actions.revealProjectFolderInTree(folderPath)}
        >
          {props.children}
        </button>
      );
    }
    if (ref?.kind === "file") {
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded border-0 bg-foreground/10 px-[0.35em] py-[0.1em] font-mono text-[0.875em] leading-none align-baseline text-accent underline-offset-2 [overflow-wrap:anywhere] hover:bg-foreground/15 hover:underline"
          onClick={() =>
            actions.openProjectRelativePath(normalizeChatRelativePath(ref.path), ref.line)
          }
        >
          {props.children}
        </button>
      );
    }
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

function renderPathChip(
  ref: ProjectPathRef,
  actions: NonNullable<ReturnType<typeof useChatPaneActions>>,
) {
  const normalized = normalizeChatRelativePath(ref.path);
  if (ref.kind === "file") {
    return (
      <InlineFilePathChip
        path={normalized}
        line={ref.line}
        onOpen={actions.openProjectRelativePath}
      />
    );
  }
  return (
    <InlineFolderPathChip
      path={normalized}
      onRevealInTree={actions.revealProjectFolderInTree}
      onShowInExplorer={actions.showProjectEntryInExplorer}
    />
  );
}

function MdTable({ children }: { children?: ReactNode }) {
  const { headerCells, bodyRows } = extractTableParts(children);
  if (headerCells.length === 0 && bodyRows.length === 0) {
    return null;
  }
  return (
    <div className="not-prose my-2 min-w-0 max-w-full overflow-hidden">
      <Table className="min-w-0 max-w-full">
        <Table.ScrollContainer className="min-w-0 max-w-full overflow-x-auto">
          <Table.Content
            aria-label="Table"
            className="text-[length:var(--lc-chat-font-size-command)]"
          >
            <Table.Header>
              {headerCells.length > 0
                ? headerCells.map((cell, i) => (
                    <Table.Column key={`col-${i}`} id={`col-${i}`} isRowHeader={i === 0}>
                      {cell}
                    </Table.Column>
                  ))
                : (bodyRows[0] ?? []).map((_, i) => (
                    <Table.Column key={`col-${i}`} id={`col-${i}`} isRowHeader={i === 0}>
                      {""}
                    </Table.Column>
                  ))}
            </Table.Header>
            <Table.Body>
              {bodyRows.map((row, ri) => (
                <Table.Row key={`row-${ri}`} id={`row-${ri}`}>
                  {row.map((cell, ci) => (
                    <Table.Cell key={`cell-${ri}-${ci}`}>{cell}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function extractTableParts(children: ReactNode): {
  headerCells: ReactNode[];
  bodyRows: ReactNode[][];
} {
  let headerCells: ReactNode[] = [];
  const bodyRows: ReactNode[][] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "thead") {
      headerCells = collectCellsFromFirstRow(getElementChildren(child), "th");
    } else if (child.type === "tbody") {
      collectRowsInto(bodyRows, getElementChildren(child));
    } else if (child.type === "tr") {
      collectRowsInto(bodyRows, [child]);
    }
  });
  return { headerCells, bodyRows };
}

function collectRowsInto(target: ReactNode[][], nodes: ReactNode) {
  Children.forEach(nodes, (child) => {
    if (!isValidElement(child) || child.type !== "tr") return;
    const cells: ReactNode[] = [];
    Children.forEach(getElementChildren(child), (cellNode) => {
      if (!isValidElement(cellNode)) return;
      if (cellNode.type === "td" || cellNode.type === "th") {
        cells.push(getElementChildren(cellNode));
      }
    });
    if (cells.length > 0) target.push(cells);
  });
}

function collectCellsFromFirstRow(nodes: ReactNode, cellTag: "th" | "td"): ReactNode[] {
  const cells: ReactNode[] = [];
  let firstTr: ReactElement | undefined;
  Children.forEach(nodes, (child) => {
    if (!firstTr && isValidElement(child) && child.type === "tr") {
      firstTr = child;
    }
  });
  if (!firstTr) return cells;
  Children.forEach(getElementChildren(firstTr), (cellNode) => {
    if (!isValidElement(cellNode)) return;
    if (cellNode.type === cellTag || cellNode.type === "td" || cellNode.type === "th") {
      cells.push(getElementChildren(cellNode));
    }
  });
  return cells;
}

function getElementChildren(element: ReactElement): ReactNode {
  const props = element.props as { children?: ReactNode };
  return props.children;
}

function flattenMdChildren(node: ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenMdChildren).join("");
  if (isValidElement(node)) {
    const p = node.props as { children?: ReactNode };
    return flattenMdChildren(p.children);
  }
  return "";
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
