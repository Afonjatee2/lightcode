import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { Reasoning } from "./Reasoning";

const originalResizeObserver = globalThis.ResizeObserver;

class MockResizeObserver {
  static instances = new Set<MockResizeObserver>();

  readonly #callback: ResizeObserverCallback;
  readonly #elements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    MockResizeObserver.instances.add(this);
  }

  observe = (element: Element) => {
    this.#elements.add(element);
  };

  unobserve = (element: Element) => {
    this.#elements.delete(element);
  };

  disconnect = () => {
    this.#elements.clear();
    MockResizeObserver.instances.delete(this);
  };

  static reset() {
    MockResizeObserver.instances.clear();
  }

  static notify(element: Element) {
    for (const instance of MockResizeObserver.instances) {
      if (!instance.#elements.has(element)) continue;
      instance.#callback([{ target: element } as ResizeObserverEntry], instance as ResizeObserver);
    }
  }
}

beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe("Reasoning", () => {
  beforeEach(() => {
    MockResizeObserver.reset();
  });

  it("keeps live reasoning pinned to the bottom while new content streams in", async () => {
    const { container, rerender } = renderReasoning(makeReasoningItem("Inspecting logs"));
    const viewport = getReasoningViewport(container);
    const content = getReasoningContent(viewport);
    const metrics = installScrollMetrics(viewport, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 0,
    });

    act(() => {
      metrics.setScrollTop(200);
      fireEvent.scroll(viewport);
    });

    act(() => {
      rerenderReasoning(rerender, makeReasoningItem("Inspecting logs\nChecking tail output"));
      metrics.setScrollHeight(320);
      MockResizeObserver.notify(content);
    });

    await waitFor(() => expect(metrics.getScrollTop()).toBe(320));
  });

  it("stops auto-scrolling once the user scrolls up inside the live reasoning block", async () => {
    const { container, rerender } = renderReasoning(makeReasoningItem("Inspecting logs"));
    const viewport = getReasoningViewport(container);
    const content = getReasoningContent(viewport);
    const metrics = installScrollMetrics(viewport, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 0,
    });

    act(() => {
      metrics.setScrollTop(200);
      fireEvent.scroll(viewport);
    });

    act(() => {
      metrics.setScrollTop(60);
      fireEvent.scroll(viewport);
    });

    act(() => {
      rerenderReasoning(rerender, makeReasoningItem("Inspecting logs\nChecking tail output"));
      metrics.setScrollHeight(320);
      MockResizeObserver.notify(content);
    });

    await waitFor(() => expect(metrics.getScrollTop()).toBe(60));
  });
});

function renderReasoning(item: RuntimeChatItem) {
  return render(
    <AppProvider>
      <Reasoning item={item} />
    </AppProvider>,
  );
}

function rerenderReasoning(
  rerender: ReturnType<typeof renderReasoning>["rerender"],
  item: RuntimeChatItem,
) {
  rerender(
    <AppProvider>
      <Reasoning item={item} />
    </AppProvider>,
  );
}

function makeReasoningItem(text: string): RuntimeChatItem {
  return {
    id: "reasoning-1",
    type: "reasoning",
    state: "updated",
    streams: { reasoning_text: text },
  };
}

function getReasoningViewport(container: HTMLElement): HTMLDivElement {
  const element = container.querySelector(".overflow-y-auto");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing reasoning viewport");
  }
  return element;
}

function getReasoningContent(viewport: HTMLDivElement): HTMLDivElement {
  const element = viewport.firstElementChild;
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing reasoning content");
  }
  return element;
}

function installScrollMetrics(
  element: HTMLDivElement,
  initial: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  let scrollHeight = initial.scrollHeight;
  let clientHeight = initial.clientHeight;
  let scrollTop = initial.scrollTop;

  Object.defineProperties(element, {
    scrollHeight: {
      configurable: true,
      get: () => scrollHeight,
    },
    clientHeight: {
      configurable: true,
      get: () => clientHeight,
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });

  return {
    getScrollTop: () => scrollTop,
    setScrollHeight: (value: number) => {
      scrollHeight = value;
    },
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}
