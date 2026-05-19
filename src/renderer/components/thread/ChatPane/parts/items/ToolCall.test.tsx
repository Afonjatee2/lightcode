import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { ToolCall } from "./ToolCall";

describe("ToolCall — Claude View (Read) rich rendering", () => {
  it("syntax-highlights the file body and strips the LLM line-number prefixes", async () => {
    const item: RuntimeChatItem = {
      id: "toolu_read",
      type: "tool_call",
      state: "completed",
      payload: {
        name: "Read",
        kind: "read",
        status: "success",
        args: { file_path: "src/renderer/hooks/useGitRefresh.ts" },
        result: ['1: import { useEffect } from "react";', "2: export const x = 1;"].join("\n"),
      },
      streams: {},
    };

    render(
      <AppProvider>
        <ToolCall item={item} />
      </AppProvider>,
    );

    fireEvent.click(getDisclosureTrigger());

    const resultViewport = await waitFor(() => {
      const viewport = getSectionViewport("result");
      if (!viewport.classList.contains("lc-shiki")) {
        throw new Error("result viewport not yet highlighted");
      }
      return viewport;
    });

    // The "1: " / "2: " line-number prefixes that the read tool emits should
    // be stripped before highlighting.
    expect(resultViewport.textContent).toContain("import { useEffect }");
    expect(resultViewport.textContent).toContain("export const x = 1;");
    expect(resultViewport.textContent).not.toMatch(/^\s*1:\s/);
    expect(resultViewport.textContent).not.toMatch(/\n\s*2:\s/);

    // Shiki produces token <span style="color:..."> nodes — confirm the body
    // is rendered as colored spans, not as a single plain <pre>.
    expect(resultViewport.querySelectorAll('span[style*="color"]').length).toBeGreaterThan(0);
  });

  it("falls back to plain rendering when the read result has no detectable language", async () => {
    const item: RuntimeChatItem = {
      id: "toolu_read_unknown",
      type: "tool_call",
      state: "completed",
      payload: {
        name: "Read",
        kind: "read",
        status: "success",
        args: { file_path: "notes-without-extension" },
        result: "plain note body",
      },
      streams: {},
    };

    render(
      <AppProvider>
        <ToolCall item={item} />
      </AppProvider>,
    );

    fireEvent.click(getDisclosureTrigger());

    const resultViewport = await waitFor(() => {
      const viewport = getSectionViewport("result");
      if (!viewport.textContent?.includes("plain note body")) {
        throw new Error("result viewport not populated yet");
      }
      return viewport;
    });

    // Result viewport for an unknown language stays in a plain <pre>, not the
    // Shiki container. The args section (JSON) may still be highlighted —
    // that's expected and irrelevant to this assertion.
    expect(resultViewport.tagName.toLowerCase()).toBe("pre");
    expect(resultViewport.classList.contains("lc-shiki")).toBe(false);
  });
});

function getDisclosureTrigger(): HTMLElement {
  const trigger = document.querySelector('[data-slot="disclosure-trigger"]');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("disclosure trigger not found");
  }
  return trigger;
}

function getSectionViewport(label: string): HTMLElement {
  const headers = Array.from(document.querySelectorAll("div")).filter(
    (el) => el.textContent?.trim() === label,
  );
  const header = headers[0];
  if (!header) {
    throw new Error(`section label "${label}" not found`);
  }
  const viewport = header.nextElementSibling;
  if (!(viewport instanceof HTMLElement)) {
    throw new Error(`viewport sibling for section "${label}" not found`);
  }
  return viewport;
}
