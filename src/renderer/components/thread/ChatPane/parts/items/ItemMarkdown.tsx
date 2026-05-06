import { Table } from "@heroui/react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatRelativePath } from "../../chatPathUtils";

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
    <div className="lc-chat-markdown prose max-w-none text-[length:var(--lc-chat-font-size)] leading-snug text-foreground prose-headings:text-[length:var(--lc-chat-font-size)] prose-p:text-[length:var(--lc-chat-font-size)] prose-li:text-[length:var(--lc-chat-font-size)] prose-pre:my-0.5 prose-pre:rounded-lg prose-pre:border prose-pre:border-white/10 prose-pre:bg-foreground/5 prose-pre:px-2.5 prose-pre:py-1.5 prose-pre:font-mono prose-pre:text-[length:var(--lc-chat-font-size)] prose-pre:leading-snug prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:underline prose-a:underline-offset-2">
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
  if (actions && isProjectPathLike(text)) {
    return (
      <button
        type="button"
        className="rounded-lg bg-foreground/10 px-1 py-0.5 font-mono text-[length:var(--lc-chat-font-size)] leading-tight text-accent underline-offset-2 hover:bg-foreground/15 hover:underline"
        onClick={() => actions.openProjectRelativePath(normalizeChatRelativePath(text))}
      >
        {text}
      </button>
    );
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
  if (actions && (isProjectPathLike(href) || href.includes("/") || href.includes("\\"))) {
    return (
      <button
        type="button"
        className="inline cursor-pointer rounded-lg border-0 bg-foreground/10 px-1 py-0.5 font-mono text-[length:var(--lc-chat-font-size)] leading-tight text-accent underline-offset-2 hover:bg-foreground/15 hover:underline"
        onClick={() => actions.openProjectRelativePath(normalizeChatRelativePath(href))}
      >
        {props.children}
      </button>
    );
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

function isProjectPathLike(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (t.includes("/") || t.includes("\\")) return true;
  return /\.(tsx?|jsx?|mjs|cjs|json|mdx?|css|scss|rs|go|py|toml|yaml|yml|vue|svelte|html?|txt)$/i.test(
    t,
  );
}
