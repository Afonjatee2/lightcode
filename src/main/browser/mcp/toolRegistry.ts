import type { BrowserPanelManager } from "../BrowserPanelManager";
import {
  addInitScript,
  addInitStyle,
  back,
  captureScreenshotPng,
  clearCookies,
  clickSelector,
  evalJs,
  evaluateOneShotStyle,
  findByA11y,
  forward,
  getCookies,
  getElementInfo,
  getElementState,
  getFrameTree,
  hoverSelector,
  pageSnapshot,
  pressKey,
  queryFirstDocumentRect,
  querySelectorAllSnapshot,
  reload,
  removeInitScript,
  resolveRefToSelector,
  scrollPage,
  setCookie,
  storageClear,
  storageGet,
  storageGetAll,
  storageRemove,
  storageSet,
  typeIntoSelector,
  waitForJs,
  waitForSelector,
  waitForText,
  waitForUrl,
} from "../cdp/tools";

const MAX_EVAL_RESULT = 64 * 1024;

export interface ToolContext {
  manager: BrowserPanelManager;
  allowEval: boolean;
  allowDataAccess: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "list_tabs",
    description: "List open tabs in the Lightcode in-app browser panel.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "new_tab",
    description: "Open a new tab in the Lightcode browser panel.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Initial URL." },
        activate: { type: "boolean", description: "Activate the new tab (default true)." },
      },
    },
  },
  {
    name: "open",
    description: "Open a URL in the active Lightcode browser tab, creating a tab if needed.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { tabId: { type: "string" }, url: { type: "string" } },
    },
  },
  {
    name: "activate_tab",
    description: "Make the given tab the active visible tab.",
    inputSchema: {
      type: "object",
      required: ["tabId"],
      properties: { tabId: { type: "string" } },
    },
  },
  {
    name: "close_tab",
    description: "Close a tab.",
    inputSchema: {
      type: "object",
      required: ["tabId"],
      properties: { tabId: { type: "string" } },
    },
  },
  {
    name: "navigate",
    description: "Navigate a tab (active tab if tabId is omitted) to a URL.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { tabId: { type: "string" }, url: { type: "string" } },
    },
  },
  {
    name: "back",
    description: "Go back in the tab's history.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
  },
  {
    name: "forward",
    description: "Go forward in the tab's history.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
  },
  {
    name: "reload",
    description: "Reload the tab.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
  },
  {
    name: "get_url",
    description: "Return the tab's current URL.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
  },
  {
    name: "get_title",
    description: "Return the tab's current page title.",
    inputSchema: { type: "object", properties: { tabId: { type: "string" } } },
  },
  {
    name: "screenshot",
    description: "Take a PNG screenshot of the tab (full page, viewport, or a CSS selector clip).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        selector: { type: "string", description: "If set, clip to this element." },
        fullPage: { type: "boolean", description: "Capture beyond the viewport." },
      },
    },
  },
  {
    name: "query",
    description:
      "Run document.querySelectorAll and return up to 20 elements' text, outerHTML (truncated), and bounds.",
    inputSchema: {
      type: "object",
      required: ["selector"],
      properties: { tabId: { type: "string" }, selector: { type: "string" } },
    },
  },
  {
    name: "wait_for",
    description: "Poll until a selector matches at least one element, or timeoutMs elapses.",
    inputSchema: {
      type: "object",
      required: ["selector"],
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "click",
    description: "Click the first element matching the selector.",
    inputSchema: {
      type: "object",
      required: ["selector"],
      properties: { tabId: { type: "string" }, selector: { type: "string" } },
    },
  },
  {
    name: "type",
    description: "Focus a selector and type text. submit=true presses Enter at the end.",
    inputSchema: {
      type: "object",
      required: ["selector", "text"],
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
    },
  },
  {
    name: "eval",
    description:
      "Evaluate a JS expression in the page's main world. Disabled by default; enable in Lightcode settings.",
    inputSchema: {
      type: "object",
      required: ["js"],
      properties: { tabId: { type: "string" }, js: { type: "string" } },
    },
  },
  {
    name: "snapshot",
    description:
      "Concise structured snapshot of the page: viewport + visible interactive elements with role, accessible name, text, opaque ref, rect. Prefer this over CSS selectors when reasoning about a page.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        maxNodes: { type: "number" },
        includeHidden: { type: "boolean" },
      },
    },
  },
  {
    name: "inspect",
    description:
      "Inspect the page with a structured snapshot of visible interactive elements, roles, text, refs, and bounds.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        maxNodes: { type: "number" },
        includeHidden: { type: "boolean" },
      },
    },
  },
  {
    name: "get",
    description:
      "Read fields from the first element matching `selector` (or `ref`). Pick from: text, html, value, attr (requires `attr`), count, box, styles (requires `styles[]`).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        ref: { type: "string" },
        fields: { type: "array", items: { type: "string" } },
        attr: { type: "string" },
        styles: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "is",
    description: "State checks for an element: exists / visible / enabled / checked / focused.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        ref: { type: "string" },
      },
    },
  },
  {
    name: "find",
    description:
      "Find an element by accessibility-first criteria (role, name, label, placeholder, text, testid). Returns selector+ref and candidate count. Use `nth` to pick among multiple matches.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        role: { type: "string" },
        name: { type: "string" },
        label: { type: "string" },
        placeholder: { type: "string" },
        text: { type: "string" },
        testid: { type: "string" },
        nth: { type: "number" },
      },
    },
  },
  {
    name: "hover",
    description: "Move the mouse over an element (selector or ref).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        ref: { type: "string" },
      },
    },
  },
  {
    name: "press",
    description: "Press a key (Enter, Tab, Escape, ArrowDown, etc.) globally on the page.",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: { tabId: { type: "string" }, key: { type: "string" } },
    },
  },
  {
    name: "scroll",
    description:
      "Scroll the page by x/y, or scroll an element into view if `selector`/`ref` is given.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        selector: { type: "string" },
        ref: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "wait_for_url",
    description: "Wait until the URL matches `pattern` (substring or /regex/).",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        tabId: { type: "string" },
        pattern: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "wait_for_text",
    description: "Wait until the literal text appears in the page's innerText.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        tabId: { type: "string" },
        text: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "wait_for_js",
    description: "Wait until `js` evaluates to truthy. Requires eval to be enabled.",
    inputSchema: {
      type: "object",
      required: ["js"],
      properties: {
        tabId: { type: "string" },
        js: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "console",
    description:
      "Return recent console/exception entries captured from the page. Optional level filter; `clear:true` resets the buffer.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        limit: { type: "number" },
        level: {
          type: "string",
          enum: ["log", "warn", "error", "info", "debug", "exception"],
        },
        clear: { type: "boolean" },
      },
    },
  },
  {
    name: "requests",
    description:
      "Recent network requests for the tab (URL, method, status, duration, size). Optional `filter` substring or /regex/. Capture is lazily enabled on first call.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        filter: { type: "string" },
        limit: { type: "number" },
        clear: { type: "boolean" },
      },
    },
  },
  {
    name: "cookies",
    description:
      'Cookies for the tab. `op:"get"` returns matching cookies; `op:"set"` upserts; `op:"clear"` deletes (filter optional). Requires allowDataAccess in Lightcode settings.',
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        op: { type: "string", enum: ["get", "set", "clear"] },
        urls: { type: "array", items: { type: "string" } },
        cookie: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            url: { type: "string" },
            domain: { type: "string" },
            path: { type: "string" },
            secure: { type: "boolean" },
            httpOnly: { type: "boolean" },
            sameSite: { type: "string", enum: ["Strict", "Lax", "None"] },
            expires: { type: "number" },
          },
        },
        filter: {
          type: "object",
          properties: {
            name: { type: "string" },
            domain: { type: "string" },
            url: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "storage",
    description:
      'Read/write localStorage or sessionStorage. `op:"getAll"|"get"|"set"|"remove"|"clear"`. Requires allowDataAccess in Lightcode settings.',
    inputSchema: {
      type: "object",
      required: ["op", "kind"],
      properties: {
        tabId: { type: "string" },
        kind: { type: "string", enum: ["local", "session"] },
        op: { type: "string", enum: ["getAll", "get", "set", "remove", "clear"] },
        key: { type: "string" },
        value: { type: "string" },
      },
    },
  },
  {
    name: "dialog",
    description:
      'Accept/dismiss/answer the next JavaScript dialog (alert/confirm/prompt). `op:"set"` arms the next dialog; `op:"wait"` arms and waits for the dialog to appear (returns its message). `op:"recent"` returns the dialog history.',
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        op: { type: "string", enum: ["set", "wait", "recent"] },
        action: { type: "string", enum: ["accept", "dismiss"] },
        promptText: { type: "string" },
        timeoutMs: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "frames",
    description:
      "List the tab's frame tree (frame id, url, parent, security origin). Use to discover iframes for further targeting.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string" } },
    },
  },
  {
    name: "addscript",
    description:
      'Inject a JavaScript snippet to run on every new document (Page.addScriptToEvaluateOnNewDocument). Returns an `identifier` you can later pass to `op:"remove"`. `op:"removeAll"` removes all init scripts added by this tool.',
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        op: { type: "string", enum: ["add", "remove", "removeAll"] },
        source: { type: "string" },
        identifier: { type: "string" },
      },
    },
  },
  {
    name: "addstyle",
    description:
      'Inject CSS. `op:"add"` registers a persistent style on every new document; `op:"oneshot"` injects into the current document only.',
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string" },
        op: { type: "string", enum: ["add", "oneshot"] },
        css: { type: "string" },
      },
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

const TOOL_ALIASES = new Map([
  ["open", "navigate"],
  ["inspect", "snapshot"],
]);

export function normalizeToolName(name: string): string {
  return TOOL_ALIASES.get(name) ?? name;
}

export function isKnownToolName(name: string): boolean {
  return TOOL_NAMES.has(normalizeToolName(name));
}

async function resolveTabId(ctx: ToolContext, payload: Record<string, unknown>): Promise<string> {
  const requested = typeof payload.tabId === "string" ? payload.tabId : null;
  if (requested) return requested;
  const active = ctx.manager.getActiveTab();
  if (active) return active.tabId;
  const info = await ctx.manager.createTab({ activate: true });
  return info.tabId;
}

type ResolvedBrowserTab = NonNullable<ReturnType<BrowserPanelManager["getActiveTab"]>>;

async function resolveSelectorArg(
  tab: ResolvedBrowserTab,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (typeof payload.selector === "string" && payload.selector.length > 0) {
    return payload.selector;
  }
  if (typeof payload.ref === "string" && payload.ref.length > 0) {
    await tab.cdp.attach();
    return await resolveRefToSelector(tab.cdp, payload.ref);
  }
  return null;
}

/** Raw dispatch returning JS objects. The MCP wrapper formats these into the
 *  proper content shape. */
export async function dispatchTool(
  name: string,
  payload: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (normalizeToolName(name)) {
    case "list_tabs":
      return ctx.manager.snapshot();
    case "new_tab": {
      const url = typeof payload.url === "string" ? payload.url : undefined;
      const activate = payload.activate !== false;
      return await ctx.manager.createTab({ ...(url ? { url } : {}), activate });
    }
    case "activate_tab": {
      ctx.manager.setActiveTab(String(payload.tabId ?? ""));
      return { ok: true };
    }
    case "close_tab": {
      await ctx.manager.closeTab(String(payload.tabId ?? ""));
      return { ok: true };
    }
    case "navigate": {
      const tabId = await resolveTabId(ctx, payload);
      const url = String(payload.url ?? "");
      if (!url) throw new Error("url required");
      await ctx.manager.navigate(tabId, url);
      return { ok: true, tabId };
    }
    case "back": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      await back(tab.cdp);
      return { ok: true };
    }
    case "forward": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      await forward(tab.cdp);
      return { ok: true };
    }
    case "reload": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      await reload(tab.cdp);
      return { ok: true };
    }
    case "get_url": {
      const { tab } = await requireTab(ctx, payload);
      return { url: tab.snapshot().url };
    }
    case "get_title": {
      const { tab } = await requireTab(ctx, payload);
      return { title: tab.snapshot().title };
    }
    case "screenshot": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const selector = typeof payload.selector === "string" ? payload.selector : undefined;
      const fullPage = payload.fullPage === true;

      // Prefer `webContents.capturePage` for in-viewport captures — it reads
      // the renderer's already-painted bitmap without resizing the page, so
      // the user sees no jump. Fall back to CDP `captureBeyondViewport` only
      // for `fullPage` or off-viewport selector captures (those genuinely
      // need the page to be re-laid out beyond its current viewport).
      if (selector && !fullPage) {
        const viewport = await evalJs<{
          rect: { x: number; y: number; width: number; height: number } | null;
          inView: boolean;
          vw: number;
          vh: number;
        }>(
          tab.cdp,
          `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            if (!el) return { rect: null, inView: false, vw, vh };
            const r = el.getBoundingClientRect();
            const inView =
              r.width > 0 && r.height > 0 &&
              r.left >= 0 && r.top >= 0 &&
              r.right <= vw && r.bottom <= vh;
            return {
              rect: { x: r.left, y: r.top, width: r.width, height: r.height },
              inView,
              vw,
              vh,
            };
          })()`,
        );
        if (!viewport.rect) throw new Error(`selector not found: ${selector}`);
        if (viewport.inView) {
          const img = await tab.webContents.capturePage({
            x: Math.max(0, Math.floor(viewport.rect.x)),
            y: Math.max(0, Math.floor(viewport.rect.y)),
            width: Math.max(1, Math.ceil(viewport.rect.width)),
            height: Math.max(1, Math.ceil(viewport.rect.height)),
          });
          return { mimeType: "image/png", base64: img.toPNG().toString("base64") };
        }
      } else if (!selector && !fullPage) {
        const img = await tab.webContents.capturePage();
        return { mimeType: "image/png", base64: img.toPNG().toString("base64") };
      }

      // Off-viewport selector or fullPage — must use CDP, which will visibly
      // re-lay out the page to capture content outside the current viewport.
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (selector) {
        const rect = await queryFirstDocumentRect(tab.cdp, selector);
        if (!rect) throw new Error(`selector not found: ${selector}`);
        clip = {
          x: Math.max(0, Math.floor(rect.x)),
          y: Math.max(0, Math.floor(rect.y)),
          width: Math.max(1, Math.ceil(rect.width)),
          height: Math.max(1, Math.ceil(rect.height)),
        };
      }
      const bytes = await captureScreenshotPng(tab.cdp, {
        fullPage,
        ...(clip ? { clip, captureBeyondViewport: true } : {}),
      });
      return { mimeType: "image/png", base64: bytes.toString("base64") };
    }
    case "query": {
      const { tab } = await requireTab(ctx, payload);
      const selector = String(payload.selector ?? "");
      if (!selector) throw new Error("selector required");
      await tab.cdp.attach();
      return await querySelectorAllSnapshot(tab.cdp, selector, 20);
    }
    case "wait_for": {
      const { tab } = await requireTab(ctx, payload);
      const selector = String(payload.selector ?? "");
      const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5000;
      if (!selector) throw new Error("selector required");
      await tab.cdp.attach();
      const found = await waitForSelector(tab.cdp, selector, timeoutMs);
      return { found };
    }
    case "click": {
      const { tab } = await requireTab(ctx, payload);
      const selector = String(payload.selector ?? "");
      if (!selector) throw new Error("selector required");
      await tab.cdp.attach();
      await clickSelector(tab.cdp, selector);
      return { ok: true };
    }
    case "type": {
      const { tab } = await requireTab(ctx, payload);
      const selector = String(payload.selector ?? "");
      const text = String(payload.text ?? "");
      const submit = payload.submit === true;
      if (!selector) throw new Error("selector required");
      await tab.cdp.attach();
      await typeIntoSelector(tab.cdp, selector, text, submit);
      return { ok: true };
    }
    case "eval": {
      if (!ctx.allowEval) {
        return { error: "eval is disabled in Lightcode settings" };
      }
      const { tab } = await requireTab(ctx, payload);
      const expression = String(payload.js ?? "");
      if (!expression) throw new Error("js required");
      await tab.cdp.attach();
      try {
        const result = await evalJs(tab.cdp, expression);
        let serialized: unknown = result;
        if (typeof result === "string" && result.length > MAX_EVAL_RESULT) {
          serialized = `${result.slice(0, MAX_EVAL_RESULT)}...[truncated]`;
        }
        return { result: serialized };
      } catch (err) {
        return { error: (err as Error).message ?? "eval failed" };
      }
    }
    case "snapshot": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const maxNodes = typeof payload.maxNodes === "number" ? payload.maxNodes : 200;
      const includeHidden = payload.includeHidden === true;
      return await pageSnapshot(tab.cdp, { maxNodes, includeHidden });
    }
    case "get": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const selector = await resolveSelectorArg(tab, payload);
      if (!selector) throw new Error("selector or ref required");
      const fieldsRaw = Array.isArray(payload.fields) ? (payload.fields as string[]) : ["text"];
      const fields = fieldsRaw.filter(
        (f): f is "text" | "html" | "value" | "attr" | "count" | "box" | "styles" =>
          ["text", "html", "value", "attr", "count", "box", "styles"].includes(f),
      );
      const attrName = typeof payload.attr === "string" ? payload.attr : undefined;
      const styles = Array.isArray(payload.styles) ? (payload.styles as string[]) : undefined;
      return await getElementInfo(tab.cdp, selector, fields, attrName, styles);
    }
    case "is": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const selector = await resolveSelectorArg(tab, payload);
      if (!selector) throw new Error("selector or ref required");
      return await getElementState(tab.cdp, selector);
    }
    case "find": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      return await findByA11y(tab.cdp, {
        ...(typeof payload.role === "string" ? { role: payload.role } : {}),
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        ...(typeof payload.label === "string" ? { label: payload.label } : {}),
        ...(typeof payload.placeholder === "string" ? { placeholder: payload.placeholder } : {}),
        ...(typeof payload.text === "string" ? { text: payload.text } : {}),
        ...(typeof payload.testid === "string" ? { testid: payload.testid } : {}),
        ...(typeof payload.nth === "number" ? { nth: payload.nth } : {}),
      });
    }
    case "hover": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const selector = await resolveSelectorArg(tab, payload);
      if (!selector) throw new Error("selector or ref required");
      await hoverSelector(tab.cdp, selector);
      return { ok: true };
    }
    case "press": {
      const { tab } = await requireTab(ctx, payload);
      const key = String(payload.key ?? "");
      if (!key) throw new Error("key required");
      await tab.cdp.attach();
      await pressKey(tab.cdp, key);
      return { ok: true };
    }
    case "scroll": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const selector =
        typeof payload.selector === "string" || typeof payload.ref === "string"
          ? await resolveSelectorArg(tab, payload)
          : undefined;
      await scrollPage(tab.cdp, {
        ...(selector ? { selector } : {}),
        ...(typeof payload.x === "number" ? { x: payload.x } : {}),
        ...(typeof payload.y === "number" ? { y: payload.y } : {}),
      });
      return { ok: true };
    }
    case "wait_for_url": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const pattern = String(payload.pattern ?? "");
      const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5000;
      if (!pattern) throw new Error("pattern required");
      const url = await waitForUrl(tab.cdp, pattern, timeoutMs);
      return { url };
    }
    case "wait_for_text": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const text = String(payload.text ?? "");
      const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5000;
      if (!text) throw new Error("text required");
      await waitForText(tab.cdp, text, timeoutMs);
      return { ok: true };
    }
    case "wait_for_js": {
      if (!ctx.allowEval) {
        return { error: "wait_for_js requires eval to be enabled in settings" };
      }
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const expression = String(payload.js ?? "");
      const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 5000;
      if (!expression) throw new Error("js required");
      const result = await waitForJs(tab.cdp, expression, timeoutMs);
      return { result };
    }
    case "console": {
      const { tab } = await requireTab(ctx, payload);
      const limit = typeof payload.limit === "number" ? payload.limit : 50;
      const level =
        typeof payload.level === "string"
          ? (payload.level as "log" | "warn" | "error" | "info" | "debug" | "exception")
          : undefined;
      let entries = tab.getConsoleEntries(limit);
      if (level) entries = entries.filter((e) => e.level === level);
      if (payload.clear === true) tab.clearConsole();
      return { entries };
    }
    case "requests": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      if (!tab.network.isEnabled()) {
        await tab.network.enable(tab.cdp);
      }
      const filter = typeof payload.filter === "string" ? payload.filter : undefined;
      const limit = typeof payload.limit === "number" ? payload.limit : 100;
      const entries = tab.network.list({ ...(filter ? { filter } : {}), limit });
      if (payload.clear === true) tab.network.clear();
      return { count: entries.length, requests: entries };
    }
    case "cookies": {
      if (!ctx.allowDataAccess) {
        return {
          error:
            "cookies is disabled. Enable 'Allow agents to read/write cookies and storage' in Lightcode settings.",
        };
      }
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const op = String(payload.op ?? "get") as "get" | "set" | "clear";
      if (op === "get") {
        const urls = Array.isArray(payload.urls) ? (payload.urls as string[]) : undefined;
        const cookies = await getCookies(tab.cdp, urls);
        return { cookies };
      }
      if (op === "set") {
        const cookie = payload.cookie as Parameters<typeof setCookie>[1] | undefined;
        if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
          throw new Error("cookie.name and cookie.value required for op:set");
        }
        const ok = await setCookie(tab.cdp, cookie);
        return { ok };
      }
      if (op === "clear") {
        const filter = (payload.filter ?? undefined) as
          | { name?: string; domain?: string; url?: string }
          | undefined;
        return await clearCookies(tab.cdp, filter);
      }
      throw new Error(`unknown cookies op: ${op}`);
    }
    case "storage": {
      if (!ctx.allowDataAccess) {
        return {
          error:
            "storage is disabled. Enable 'Allow agents to read/write cookies and storage' in Lightcode settings.",
        };
      }
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const kind = (payload.kind === "session" ? "session" : "local") as "local" | "session";
      const op = String(payload.op ?? "");
      if (op === "getAll") {
        const items = await storageGetAll(tab.cdp, kind);
        return { items };
      }
      if (op === "get") {
        const key = String(payload.key ?? "");
        if (!key) throw new Error("key required");
        const value = await storageGet(tab.cdp, kind, key);
        return { value };
      }
      if (op === "set") {
        const key = String(payload.key ?? "");
        const value = String(payload.value ?? "");
        if (!key) throw new Error("key required");
        await storageSet(tab.cdp, kind, key, value);
        return { ok: true };
      }
      if (op === "remove") {
        const key = String(payload.key ?? "");
        if (!key) throw new Error("key required");
        await storageRemove(tab.cdp, kind, key);
        return { ok: true };
      }
      if (op === "clear") {
        await storageClear(tab.cdp, kind);
        return { ok: true };
      }
      throw new Error(`unknown storage op: ${op}`);
    }
    case "dialog": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const op = String(payload.op ?? "set") as "set" | "wait" | "recent";
      if (op === "recent") {
        const limit = typeof payload.limit === "number" ? payload.limit : 10;
        return { dialogs: tab.dialogs.recent(limit) };
      }
      const action = (payload.action === "dismiss" ? "dismiss" : "accept") as "accept" | "dismiss";
      const promptText = typeof payload.promptText === "string" ? payload.promptText : undefined;
      const disposition = {
        action,
        ...(promptText != null ? { promptText } : {}),
      };
      if (op === "set") {
        tab.dialogs.setNextDisposition(disposition);
        return { ok: true, armed: disposition };
      }
      if (op === "wait") {
        const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 10_000;
        const entry = await tab.dialogs.waitForNext(disposition, timeoutMs);
        return entry ? { dialog: entry } : { dialog: null };
      }
      throw new Error(`unknown dialog op: ${op}`);
    }
    case "frames": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const frames = await getFrameTree(tab.cdp);
      return { frames };
    }
    case "addscript": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const op = String(payload.op ?? "add") as "add" | "remove" | "removeAll";
      if (op === "add") {
        const source = String(payload.source ?? "");
        if (!source) throw new Error("source required");
        const res = await addInitScript(tab.cdp, source);
        tab.rememberInitScript(res.identifier);
        return { identifier: res.identifier };
      }
      if (op === "remove") {
        const identifier = String(payload.identifier ?? "");
        if (!identifier) throw new Error("identifier required");
        await removeInitScript(tab.cdp, identifier);
        tab.forgetInitScript(identifier);
        return { ok: true };
      }
      if (op === "removeAll") {
        const ids = tab.listInitScripts();
        for (const id of ids) {
          try {
            await removeInitScript(tab.cdp, id);
          } catch {}
          tab.forgetInitScript(id);
        }
        return { ok: true, removed: ids.length };
      }
      throw new Error(`unknown addscript op: ${op}`);
    }
    case "addstyle": {
      const { tab } = await requireTab(ctx, payload);
      await tab.cdp.attach();
      const op = String(payload.op ?? "add") as "add" | "oneshot";
      const css = String(payload.css ?? "");
      if (!css) throw new Error("css required");
      if (op === "add") {
        const res = await addInitStyle(tab.cdp, css);
        tab.rememberInitScript(res.identifier);
        return { identifier: res.identifier };
      }
      if (op === "oneshot") {
        await evaluateOneShotStyle(tab.cdp, css);
        return { ok: true };
      }
      throw new Error(`unknown addstyle op: ${op}`);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function requireTab(
  ctx: ToolContext,
  payload: Record<string, unknown>,
): Promise<{ tab: ResolvedBrowserTab }> {
  const tabId = await resolveTabId(ctx, payload);
  const tab = ctx.manager.getTab(tabId);
  if (!tab) throw new Error(`unknown tab ${tabId}`);
  return { tab };
}

export interface McpContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

/** Wrap a raw tool result into the MCP `content[]` shape. Special-cased for
 *  screenshot (image content). */
export function formatToolResult(name: string, result: unknown): McpToolResult {
  if (
    normalizeToolName(name) === "screenshot" &&
    result &&
    typeof result === "object" &&
    "base64" in result
  ) {
    const r = result as { base64: string; mimeType?: string };
    return {
      content: [
        {
          type: "image",
          data: r.base64,
          mimeType: r.mimeType ?? "image/png",
        },
      ],
    };
  }
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof (result as { error: unknown }).error === "string"
  ) {
    return {
      content: [{ type: "text", text: String((result as { error: string }).error) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
