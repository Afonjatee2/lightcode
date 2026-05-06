import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { AppProvider } from "@/renderer/components/ui/provider";
import { useAppStore } from "@/renderer/state/appStore";
import { ChatPane } from "./ChatPane";

const { hydrateThreadRuntimeItems } = vi.hoisted(() => ({
  hydrateThreadRuntimeItems: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@/renderer/state/chatRuntimePersister", () => ({
  hydrateThreadRuntimeItems,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: {
    count: number;
    getItemKey?: (index: number) => string | number;
  }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        key: options.getItemKey?.(index) ?? index,
        index,
        start: index * 96,
      })),
    getTotalSize: () => options.count * 96,
    measure: vi.fn<() => void>(),
    measureElement: vi.fn<(element: HTMLDivElement | null) => void>(),
  }),
}));

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

describe("ChatPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.reset();
    localStorage.clear();
    Reflect.deleteProperty(window, "lightcode");
    useAppStore.setState((state) => ({
      ...state,
      projects: [],
      threads: [],
      pendingServerRequests: [],
      view: { kind: "home" },
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeRequestsByThread: {},
    }));
  });

  it("keeps the chat pinned when the last plan item grows without changing the scroll anchor", async () => {
    const thread = makeThread();
    seedPlanItem(thread.id, [{ step: "Inspect output", status: "in_progress" }]);

    const { container } = renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const scrollElement = getScrollElement(container);
    const contentElement = getContentElement(scrollElement);
    const metrics = installScrollMetrics(scrollElement, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 0,
    });

    act(() => {
      metrics.setScrollTop(200);
      fireEvent.scroll(scrollElement);
    });

    act(() => {
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "item.updated",
        threadId: thread.id,
        itemId: PLAN_ITEM_ID,
        payload: {
          steps: [
            { step: "Inspect output", status: "completed" },
            { step: "Open logs", status: "in_progress" },
          ],
        },
      });
    });

    await screen.findByText("Open logs");

    act(() => {
      metrics.setScrollHeight(300);
      MockResizeObserver.notify(contentElement);
    });

    await waitFor(() => expect(metrics.getScrollTop()).toBe(300));
  });

  it("re-pins in the same resize frame when bottom-pinned content collapses", async () => {
    const thread = makeThread();
    seedPlanItem(thread.id, [{ step: "Inspect output", status: "in_progress" }]);

    const { container } = renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const scrollElement = getScrollElement(container);
    const contentElement = getContentElement(scrollElement);
    const metrics = installScrollMetrics(scrollElement, {
      scrollHeight: 320,
      clientHeight: 100,
      scrollTop: 0,
    });

    act(() => {
      metrics.setScrollTop(320);
      fireEvent.scroll(scrollElement);
    });

    act(() => {
      metrics.setScrollHeight(220);
      MockResizeObserver.notify(contentElement);
    });

    expect(metrics.getScrollTop()).toBe(220);
  });

  it("does not pull the user back to the bottom after they scroll up", async () => {
    const thread = makeThread();
    seedPlanItem(thread.id, [{ step: "Inspect output", status: "in_progress" }]);

    const { container } = renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const scrollElement = getScrollElement(container);
    const contentElement = getContentElement(scrollElement);
    const metrics = installScrollMetrics(scrollElement, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 0,
    });

    act(() => {
      metrics.setScrollTop(200);
      fireEvent.scroll(scrollElement);
    });

    act(() => {
      metrics.setScrollTop(80);
      fireEvent.scroll(scrollElement);
    });

    act(() => {
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "item.updated",
        threadId: thread.id,
        itemId: PLAN_ITEM_ID,
        payload: {
          steps: [
            { step: "Inspect output", status: "completed" },
            { step: "Open logs", status: "in_progress" },
          ],
        },
      });
    });

    await screen.findByText("Open logs");

    act(() => {
      metrics.setScrollHeight(300);
      MockResizeObserver.notify(contentElement);
    });

    await waitFor(() => expect(metrics.getScrollTop()).toBe(80));
  });

  it("keeps running command accordions closed until clicked", async () => {
    const thread = makeThread();
    seedCommandItem(thread.id, "cmd-1", "npm run test", "command output");

    renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const trigger = screen.getByText("Check: npm run test").closest("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/command output/)).not.toBeInTheDocument();

    fireEvent.click(trigger!);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await screen.findByText(/command output/);
  });

  it("keeps ACP command accordions closed while live output streams in", async () => {
    const thread = makeThread();
    startCommandItem(thread.id, "cmd-1", "npm run test");

    renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const trigger = screen.getByText("Check: npm run test").closest("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    act(() => {
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "content.delta",
        threadId: thread.id,
        itemId: "cmd-1",
        stream: "command_output",
        delta: "streamed output",
      });
    });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/streamed output/)).not.toBeInTheDocument();
  });

  it("keeps running tool-call groups closed until clicked", async () => {
    const thread = makeThread();
    seedCommandItem(thread.id, "cmd-1", "echo one", "one");
    seedCommandItem(thread.id, "cmd-2", "echo two", "two");

    renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    const trigger = screen.getByText(/^2 tool calls:/).closest("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger!);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps ACP tool-call groups closed when a live row folds into a group", async () => {
    const thread = makeThread();
    seedCommandItem(thread.id, "cmd-1", "echo one", "first output");

    renderChatPane(thread);
    await waitFor(() => expect(hydrateThreadRuntimeItems).toHaveBeenCalledWith(thread.id));

    expect(screen.getByText("echo one").closest("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    act(() => {
      startCommandItem(thread.id, "cmd-2", "echo two");
      useAppStore.getState().applyRuntimeEvent(thread.id, {
        type: "content.delta",
        threadId: thread.id,
        itemId: "cmd-2",
        stream: "command_output",
        delta: "second output",
      });
    });

    const trigger = await screen.findByText(/^2 tool calls:/);
    expect(trigger.closest("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/first output/)).not.toBeInTheDocument();
    expect(screen.queryByText(/second output/)).not.toBeInTheDocument();
  });
});

function renderChatPane(thread: Thread) {
  return render(
    <AppProvider>
      <ChatPane thread={thread} />
    </AppProvider>,
  );
}

const PLAN_ITEM_ID = "plan-1";

function seedPlanItem(
  threadId: string,
  steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>,
) {
  useAppStore.getState().applyRuntimeEvent(threadId, {
    type: "item.started",
    threadId,
    itemId: PLAN_ITEM_ID,
    itemType: "plan",
  });
  useAppStore.getState().applyRuntimeEvent(threadId, {
    type: "item.updated",
    threadId,
    itemId: PLAN_ITEM_ID,
    payload: { steps },
  });
}

function seedCommandItem(threadId: string, itemId: string, command: string, output: string) {
  startCommandItem(threadId, itemId, command);
  useAppStore.getState().applyRuntimeEvent(threadId, {
    type: "content.delta",
    threadId,
    itemId,
    stream: "command_output",
    delta: output,
  });
}

function startCommandItem(threadId: string, itemId: string, command: string) {
  useAppStore.getState().applyRuntimeEvent(threadId, {
    type: "item.started",
    threadId,
    itemId,
    itemType: "command_execution",
    payload: { command },
  });
}

function makeThread(): Thread {
  const now = new Date().toISOString();
  return {
    id: "thread-gui",
    projectId: "project-1",
    title: "ACP thread",
    agentKind: "copilot",
    config: {
      model: "gpt-5.4",
    },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: now,
    updatedAt: now,
  };
}

function getScrollElement(container: HTMLElement): HTMLDivElement {
  const element = container.querySelector(".overflow-y-auto");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing chat scroll container");
  }
  return element;
}

function getContentElement(scrollElement: HTMLDivElement): HTMLDivElement {
  const element = scrollElement.firstElementChild;
  if (!(element instanceof HTMLDivElement)) {
    throw new Error("missing chat content wrapper");
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
    setClientHeight: (value: number) => {
      clientHeight = value;
    },
    setScrollHeight: (value: number) => {
      scrollHeight = value;
    },
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}
