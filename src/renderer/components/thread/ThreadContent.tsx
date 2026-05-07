import type { RefObject } from "react";
import type {
  AgentStatus,
  ProjectLocation,
  PromptSegment,
  Thread,
  ThreadConfig,
  ThreadServerRequestId,
} from "@/shared/contracts";
import { PixelLoader } from "../common";
import type { PendingThreadServerRequest } from "@/renderer/state/appStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useThread } from "@/renderer/state/useThread";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { ChatPane } from "./ChatPane/ChatPane";
import { ChatRuntimeDebugPanel } from "./ChatPane/ChatRuntimeDebugPanel";
import { guiChatFontCssVars } from "./ChatPane/chatFontVars";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { ThreadComposerSection } from "./ThreadComposerSection";
import { ThreadTodoDock } from "./ThreadTodoDock";
import { getThreadErrorDockStateForItem, selectThreadLatestErrorItem } from "./threadErrorState";
import { getThreadTodoDockStateForItem, selectThreadTodoDockItem } from "./threadTodoState";

type CommonContentProps = {
  threadId: string;
  fallbackThread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  paneCount: number;
  pendingServerRequests: PendingThreadServerRequest[];
  terminalPaneRef: RefObject<TerminalPaneHandle | null>;
  onConfigChange: (config: ThreadConfig) => void;
  onResolveServerRequest: (input: {
    requestId: ThreadServerRequestId;
    method: string;
    response: unknown;
  }) => Promise<void>;
  onSubmitInput: (prompt: string, segments?: PromptSegment[]) => Promise<void>;
};

const emptyTodoComposerProps = {
  todoDockCollapsed: false,
  todoDockPlacement: "composer" as const,
  todoDockState: null,
  errorDockState: null,
  onTodoDockCollapsedChange: () => undefined,
  onTodoDockPlacementChange: () => undefined,
};

export function TerminalThreadContent(
  props: CommonContentProps & {
    onTerminalResize: (size: { cols: number; rows: number }) => void;
  },
) {
  const thread = useThread(props.threadId) ?? props.fallbackThread;

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-visible">
        <TerminalPane
          ref={props.terminalPaneRef}
          key={thread.id}
          onTerminalResize={props.onTerminalResize}
          status={thread.status}
          threadId={thread.id}
        />
        {thread.status === "launching" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <PixelLoader size="md" />
          </div>
        ) : null}
      </div>
      <ThreadComposerSection {...props} {...emptyTodoComposerProps} />
    </>
  );
}

export function GuiThreadContent(
  props: CommonContentProps & {
    runtimeDebugOpen: boolean;
  },
) {
  const { runtimeDebugOpen } = props;
  const thread = useThread(props.threadId) ?? props.fallbackThread;
  const guiChatFontSize = useSharedSettings((s) => s.guiChatFontSize);
  const todoDockPlacement = useThreadTodoDockStore((s) => s.placement);
  const todoDockCollapsed = useThreadTodoDockStore((s) => s.collapsed);
  const setTodoDockPlacement = useThreadTodoDockStore((s) => s.setPlacement);
  const setTodoDockCollapsed = useThreadTodoDockStore((s) => s.setCollapsed);
  const todoDockItem = useAppStore((s) => selectThreadTodoDockItem(s, props.threadId));
  const todoDockState = todoDockItem ? getThreadTodoDockStateForItem(todoDockItem) : null;
  const errorItem = useAppStore((s) => selectThreadLatestErrorItem(s, props.threadId));
  const errorDockState = errorItem ? getThreadErrorDockStateForItem(errorItem) : null;
  const showTodoDock = todoDockState !== null;
  const showTodoInRightRail = showTodoDock && todoDockPlacement === "right";
  const showThreadSideRail = runtimeDebugOpen || showTodoInRightRail;
  const hiddenRuntimeItemId = todoDockState?.sourceItemId;
  const hiddenRuntimeItemIsLive = todoDockState !== null && todoDockState.itemState !== "completed";

  return (
    <>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="flex h-full min-h-0 w-full gap-2 text-[length:var(--lc-chat-font-size)]"
          style={guiChatFontCssVars(guiChatFontSize)}
        >
          <div className="min-h-0 min-w-0 flex-1">
            <ChatPane
              hasSupplementaryContent={showTodoDock}
              hiddenRuntimeItemId={hiddenRuntimeItemId}
              hiddenRuntimeItemIsLive={hiddenRuntimeItemIsLive}
              thread={thread}
            />
          </div>
          {showThreadSideRail ? (
            <div className="flex h-full min-h-0 w-[min(44%,24rem)] shrink-0 flex-col gap-2 border-l border-[color:var(--border)] pl-2">
              {showTodoInRightRail ? (
                <div
                  className={
                    runtimeDebugOpen && !todoDockCollapsed
                      ? "min-h-0 max-h-[45%] shrink-0"
                      : "min-h-0 flex-1"
                  }
                >
                  <ThreadTodoDock
                    collapsed={todoDockCollapsed}
                    placement={todoDockPlacement}
                    state={todoDockState!}
                    onCollapsedChange={setTodoDockCollapsed}
                    onPlacementChange={setTodoDockPlacement}
                  />
                </div>
              ) : null}
              {runtimeDebugOpen ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <p className="shrink-0 text-xs font-medium text-foreground">Runtime debug</p>
                  <ChatRuntimeDebugPanel threadId={thread.id} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <ThreadComposerSection
        {...props}
        todoDockCollapsed={todoDockCollapsed}
        todoDockPlacement={todoDockPlacement}
        todoDockState={todoDockState}
        errorDockState={errorDockState}
        onTodoDockCollapsedChange={setTodoDockCollapsed}
        onTodoDockPlacementChange={setTodoDockPlacement}
      />
    </>
  );
}
