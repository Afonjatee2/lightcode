import { Link, Table } from "@heroui/react";
import {
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import remarkGfm from "remark-gfm";
import { readBridge } from "@/renderer/bridge";
import { useChatPaneActions } from "../../chatPaneActionsContext";
import { normalizeChatProjectPath, normalizeChatRelativePath } from "../../chatPathUtils";
import { InlineFilePathChip } from "./InlineFilePathChip";
import { InlineFolderPathChip } from "./InlineFolderPathChip";
import { normalizeShortCodeFenceClosers } from "./ItemMarkdown";
import { parseProjectPathRef, type ProjectPathRef } from "./parseProjectPathRef";
import {
  AUTO_PATH_FILE_PREFIX,
  AUTO_PATH_FOLDER_PREFIX,
  remarkAutolinkProjectPaths,
} from "./remarkAutolinkProjectPaths";

type RemarkPlugins = NonNullable<ComponentProps<typeof Streamdown>["remarkPlugins"]>;

interface ItemMarkdownInnerProps {
  text: string;
}

/**
 * Heavy markdown renderer (lazy-loaded). Uses Streamdown which handles
 * incomplete syntax during streaming (unclosed fences, half-formed links,
 * dangling bold/italic) and memoizes blocks internally so re-renders during
 * streaming only re-parse the trailing block.
 */
export default function ItemMarkdownInner({ text }: ItemMarkdownInnerProps) {
  const actions = useChatPaneActions();
  const rootNames = actions?.projectRootNames;
  // Escape the React Compiler: the plugin tuple captures `rootNames`, which
  // the compiler conservatively re-creates each render. Streaming chats
  // re-render on every chunk, so anchor the array to `rootNames` identity.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional escape hatch
  const remarkPlugins = useMemo<RemarkPlugins>(
    () => [
      remarkGfm,
      [
        remarkAutolinkProjectPaths,
        {
          parsePathRef: (token: string) => {
            const ref = parseProjectPathRef(token, { rootNames });
            if (ref || !actions) return ref;
            const normalized = normalizeChatProjectPath(token, actions.projectLocation);
            return normalized === token ? null : parseProjectPathRef(normalized, { rootNames });
          },
        },
      ],
    ],
    [actions, rootNames],
  );
  const markdownText = normalizeShortCodeFenceClosers(text);
  return (
    <div className="lc-chat-markdown prose max-w-none text-[length:var(--lc-chat-font-size)] leading-snug text-foreground prose-headings:text-[length:var(--lc-chat-font-size)] prose-p:text-[length:var(--lc-chat-font-size)] prose-li:text-[length:var(--lc-chat-font-size)] prose-pre:my-2 prose-pre:rounded prose-pre:border-0 prose-pre:bg-foreground/10 prose-pre:px-[0.5em] prose-pre:py-[0.25em] prose-pre:font-mono prose-pre:text-[0.875em] prose-pre:leading-snug prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:underline prose-a:underline-offset-2">
      <Streamdown remarkPlugins={remarkPlugins} components={MD_COMPONENTS} parseIncompleteMarkdown>
        {markdownText}
      </Streamdown>
    </div>
  );
}

const MD_COMPONENTS: StreamdownComponents = {
  // Streamdown's default `pre` strips the `<pre>` wrapper and forwards
  // `data-block` to its custom code block UI. We want a plain `<pre>` so the
  // `prose-pre:*` utilities on the parent style the fenced block consistently;
  // forward `data-block` so the inner `code` component can distinguish a
  // language-less fenced block from inline code.
  pre({ children }) {
    return <pre>{markCodeChildAsBlock(children)}</pre>;
  },
  code({ className, children, ...rest }) {
    const isBlock =
      ("data-block" in rest && rest["data-block"] === "true") ||
      (typeof className === "string" && className.includes("language-"));
    return (
      <MdCode className={className ?? ""} isBlock={isBlock}>
        {children}
      </MdCode>
    );
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

function MdCode(props: { className: string; isBlock?: boolean; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const isBlock =
    props.isBlock || (typeof props.className === "string" && props.className.includes("language-"));
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

/**
 * Tag the fenced-block `<code>` child with `data-block` so the `code` override
 * can distinguish fenced blocks (no language) from inline code, which never
 * passes through a `<pre>`.
 */
function markCodeChildAsBlock(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    return cloneElement(child as ReactElement<Record<string, unknown>>, { "data-block": "true" });
  });
}

function MdAnchor(props: { href: string; children?: ReactNode }) {
  const actions = useChatPaneActions();
  const href = props.href?.trim() ?? "";
  if (!href) return <span>{props.children}</span>;

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
