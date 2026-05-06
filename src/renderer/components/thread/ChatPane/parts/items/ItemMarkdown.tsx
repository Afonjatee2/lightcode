import { Table } from "@heroui/react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatRelativePath } from "../../chatPathUtils";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";

interface ItemMarkdownProps {
  text: string;
  mode?: "markdown" | "plain";
}

const REMARK_PLUGINS = [remarkGfm];

/**
 * Compact markdown renderer used by chat rows.
 *
 * Inline `` `code` `` from markdown (CommonMark) is rendered as a subtle chip;
 * spans that look like project paths become accent buttons that open the editor
 * when the pane provides `ChatPaneActions`.
 */
export function ItemMarkdown({ text, mode = "markdown" }: ItemMarkdownProps) {
  if (mode === "plain") {
    return <PlainText text={text} />;
  }
  return (
    <div className="lc-chat-markdown prose max-w-none text-[length:var(--lc-chat-font-size)] leading-snug text-foreground prose-headings:text-[length:var(--lc-chat-font-size)] prose-p:text-[length:var(--lc-chat-font-size)] prose-li:text-[length:var(--lc-chat-font-size)] prose-pre:my-0.5 prose-pre:rounded-lg prose-pre:border prose-pre:border-white/10 prose-pre:bg-foreground/5 prose-pre:px-2.5 prose-pre:py-1.5 prose-pre:font-mono prose-pre:text-[length:var(--lc-chat-font-size)] prose-pre:leading-snug prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:underline prose-a:underline-offset-2">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function PlainText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[length:var(--lc-chat-font-size)] leading-snug text-foreground">
      {text}
    </div>
  );
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
  "rounded-lg border-0 bg-foreground/10 px-1 py-0.5 font-mono text-[length:var(--lc-chat-font-size)] leading-tight text-foreground";

function MdCode(props: { className: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const isBlock = typeof props.className === "string" && props.className.includes("language-");
  const text = flattenMdChildren(props.children).replace(/\n$/, "");
  if (isBlock) {
    return <code className={props.className || undefined}>{props.children}</code>;
  }
  if (actions) {
    const ref = parseProjectPathRef(text);
    if (ref) {
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
  }
  return <code className={inlineCodeChipClass}>{props.children}</code>;
}

function MdAnchor(props: { href: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const href = props.href?.trim() ?? "";
  if (!href) return <span>{props.children}</span>;
  if (/^(https?|mailto):/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {props.children}
      </a>
    );
  }
  if (actions) {
    const ref = parseProjectPathRef(href);
    if (ref?.kind === "folder") {
      const folderPath = normalizeChatRelativePath(ref.path);
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded-lg border-0 bg-foreground/10 px-1 py-0.5 font-mono text-[length:var(--lc-chat-font-size)] leading-tight text-accent underline-offset-2 hover:bg-foreground/15 hover:underline"
          onClick={() => actions.revealProjectFolderInTree(folderPath)}
        >
          {props.children}
        </button>
      );
    }
    const fallbackPath =
      !ref && (href.includes("/") || href.includes("\\")) ? href : undefined;
    if (ref?.kind === "file" || fallbackPath !== undefined) {
      const targetPath = ref?.kind === "file" ? ref.path : (fallbackPath as string);
      const targetLine = ref?.kind === "file" ? ref.line : undefined;
      return (
        <button
          type="button"
          className="inline cursor-pointer rounded-lg border-0 bg-foreground/10 px-1 py-0.5 font-mono text-[length:var(--lc-chat-font-size)] leading-tight text-accent underline-offset-2 hover:bg-foreground/15 hover:underline"
          onClick={() =>
            actions.openProjectRelativePath(normalizeChatRelativePath(targetPath), targetLine)
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

const PATH_EXTENSION_RE =
  /\.(tsx?|jsx?|mjs|cjs|json|mdx?|css|scss|rs|go|py|toml|yaml|yml|vue|svelte|html?|txt)$/i;

export type ProjectPathRef =
  | { kind: "file"; path: string; line?: number }
  | { kind: "folder"; path: string };

/**
 * Recognize a project path with an optional `:<line>` suffix.
 * Distinguishes files (extension or `:line`) from folders (separator with a
 * non-extension last segment, or trailing slash). Returns null for plain
 * words, URLs, or `name:digits` shapes that don't look like file paths.
 */
function parseProjectPathRef(s: string): ProjectPathRef | null {
  const t = s.trim();
  if (t.length < 2 || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return null;

  const lineMatch = t.match(/^(.+):(\d+)$/);
  const candidate = lineMatch ? lineMatch[1]! : t;
  const hasSeparator = candidate.includes("/") || candidate.includes("\\");
  const hasExtension = PATH_EXTENSION_RE.test(candidate);
  const lastSegment = candidate.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const isDotfile = lastSegment.startsWith(".") && !lastSegment.includes("/");
  const trailingSeparator = /[\\/]$/.test(candidate);

  if (!hasSeparator && !hasExtension) return null;

  if (lineMatch && Number.isFinite(Number.parseInt(lineMatch[2]!, 10))) {
    const line = Number.parseInt(lineMatch[2]!, 10);
    if (line > 0) {
      return { kind: "file", path: candidate, line };
    }
  }

  if (trailingSeparator) {
    const cleaned = candidate.replace(/[\\/]+$/, "");
    return cleaned ? { kind: "folder", path: cleaned } : null;
  }
  if (hasExtension || isDotfile) {
    return { kind: "file", path: candidate };
  }
  return { kind: "folder", path: candidate };
}
