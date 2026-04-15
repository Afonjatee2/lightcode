import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { LspIpcTransport } from "./ipcTransport";

type ITextModel = MonacoEditor.ITextModel;
type IPosition = { lineNumber: number; column: number };

type IDisposable = { dispose(): void };

// ── LSP ↔ Monaco type translation ───────────────────────────

/** LSP uses 0-based line/col. Monaco uses 1-based line/col. */
function toLspPosition(monacoPos: { lineNumber: number; column: number }) {
  return { line: monacoPos.lineNumber - 1, character: monacoPos.column - 1 };
}

function toMonacoRange(
  lspRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
  monaco: Monaco,
): InstanceType<typeof monaco.Range> {
  return new monaco.Range(
    lspRange.start.line + 1,
    lspRange.start.character + 1,
    lspRange.end.line + 1,
    lspRange.end.character + 1,
  );
}

/** Map LSP CompletionItemKind to Monaco. */
function mapCompletionKind(lspKind: number | undefined, monaco: Monaco): number {
  const k = monaco.languages.CompletionItemKind;
  // LSP kinds: 1=Text, 2=Method, 3=Function, 4=Constructor, 5=Field, 6=Variable, 7=Class, 8=Interface, 9=Module, etc.
  const map: Record<number, number> = {
    1: k.Text,
    2: k.Method,
    3: k.Function,
    4: k.Constructor,
    5: k.Field,
    6: k.Variable,
    7: k.Class,
    8: k.Interface,
    9: k.Module,
    10: k.Property,
    11: k.Unit,
    12: k.Value,
    13: k.Enum,
    14: k.Keyword,
    15: k.Snippet,
    16: k.Color,
    17: k.File,
    18: k.Reference,
    19: k.Folder,
    20: k.EnumMember,
    21: k.Constant,
    22: k.Struct,
    23: k.Event,
    24: k.Operator,
    25: k.TypeParameter,
  };
  return map[lspKind ?? 1] ?? k.Text;
}

/** Map LSP DiagnosticSeverity to Monaco MarkerSeverity. */
function mapSeverity(lspSeverity: number | undefined, monaco: Monaco): number {
  // LSP: 1=Error, 2=Warning, 3=Info, 4=Hint
  switch (lspSeverity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
}

// ── Provider registration ───────────────────────────────────

/**
 * Register Monaco language providers that forward requests to the
 * language server via the IPC transport. Returns disposables for cleanup.
 */
export function registerLspProviders(
  monaco: Monaco,
  transport: LspIpcTransport,
  languageIds: string[],
): IDisposable[] {
  const disposables: IDisposable[] = [];

  // Completion
  for (const lang of languageIds) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [".", "/", "<", '"', "'", "@", "#"],
        provideCompletionItems: async (model: ITextModel, position: IPosition) => {
          const result = (await transport.sendMessage({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "textDocument/completion",
            params: {
              textDocument: { uri: model.uri.toString() },
              position: toLspPosition(position),
            },
          })) as { items?: unknown[]; isIncomplete?: boolean } | unknown[] | null;

          if (!result) return { suggestions: [] };
          const items = Array.isArray(result) ? result : (result.items ?? []);

          return {
            suggestions: (items as LspCompletionItem[]).map((item) => ({
              label: item.label,
              kind: mapCompletionKind(item.kind, monaco),
              insertText:
                item.insertText ?? (typeof item.label === "string" ? item.label : item.label.label),
              insertTextRules:
                item.insertTextFormat === 2
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              detail: item.detail,
              documentation: item.documentation
                ? typeof item.documentation === "string"
                  ? item.documentation
                  : { value: (item.documentation as { value: string }).value }
                : undefined,
              sortText: item.sortText,
              filterText: item.filterText,
              range: undefined as unknown as InstanceType<typeof monaco.Range>,
            })),
          };
        },
      }),
    );

    // Hover
    disposables.push(
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model: ITextModel, position: IPosition) => {
          const result = (await transport.sendMessage({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "textDocument/hover",
            params: {
              textDocument: { uri: model.uri.toString() },
              position: toLspPosition(position),
            },
          })) as LspHover | null;

          if (!result?.contents) return null;

          const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
          return {
            contents: contents.map((c) => {
              if (typeof c === "string") return { value: c };
              if ("value" in c) return { value: `\`\`\`${c.language ?? ""}\n${c.value}\n\`\`\`` };
              return { value: String(c) };
            }),
            range: result.range ? toMonacoRange(result.range, monaco) : undefined,
          };
        },
      }),
    );

    // Go to definition
    disposables.push(
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model: ITextModel, position: IPosition) => {
          const result = (await transport.sendMessage({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "textDocument/definition",
            params: {
              textDocument: { uri: model.uri.toString() },
              position: toLspPosition(position),
            },
          })) as LspLocation | LspLocation[] | null;

          if (!result) return null;
          const locations = Array.isArray(result) ? result : [result];
          return locations.map((loc) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: toMonacoRange(loc.range, monaco),
          }));
        },
      }),
    );

    // Signature help
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (model: ITextModel, position: IPosition) => {
          const result = (await transport.sendMessage({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "textDocument/signatureHelp",
            params: {
              textDocument: { uri: model.uri.toString() },
              position: toLspPosition(position),
            },
          })) as LspSignatureHelp | null;

          if (!result) return null;
          return {
            value: {
              signatures: result.signatures.map((sig) => ({
                label: sig.label,
                documentation: sig.documentation
                  ? typeof sig.documentation === "string"
                    ? sig.documentation
                    : { value: (sig.documentation as { value: string }).value }
                  : undefined,
                parameters: (sig.parameters ?? []).map((p) => ({
                  label: p.label as string | [number, number],
                  documentation: p.documentation
                    ? typeof p.documentation === "string"
                      ? p.documentation
                      : { value: (p.documentation as { value: string }).value }
                    : undefined,
                })),
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0,
            },
            dispose: () => {},
          };
        },
      }),
    );
  }

  // Diagnostics — listen for publishDiagnostics notifications
  transport.onMessage((message) => {
    const msg = message as { method?: string; params?: unknown };
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as LspPublishDiagnostics;
      const uri = monaco.Uri.parse(params.uri);
      const model = monaco.editor.getModel(uri);
      if (!model) return;

      const markers = params.diagnostics.map((d) => ({
        severity: mapSeverity(d.severity, monaco),
        message: d.message,
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        source: d.source,
        code: d.code !== undefined ? String(d.code) : undefined,
      }));

      monaco.editor.setModelMarkers(model, "lsp", markers);
    }
  });

  return disposables;
}

// ── Minimal LSP type interfaces (only what we use) ──────────

interface LspCompletionItem {
  label: string | { label: string; detail?: string };
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
}

interface LspHover {
  contents:
    | string
    | { language?: string; value: string }
    | (string | { language?: string; value: string })[];
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface LspLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface LspSignatureHelp {
  signatures: {
    label: string;
    documentation?: string | { kind: string; value: string };
    parameters?: {
      label: string | [number, number];
      documentation?: string | { kind: string; value: string };
    }[];
  }[];
  activeSignature?: number;
  activeParameter?: number;
}

interface LspPublishDiagnostics {
  uri: string;
  diagnostics: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    severity?: number;
    code?: number | string;
    source?: string;
    message: string;
  }[];
}
