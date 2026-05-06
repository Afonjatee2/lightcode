import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { memo } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { getRuntimeItemStoreSelector, type ChatTimelineEntry } from "../../chatPaneSelectors";
import { AssistantMessage } from "./AssistantMessage";
import { CommandExecution } from "./CommandExecution";
import { ErrorItem } from "./ErrorItem";
import { FileChange } from "./FileChange";
import { PlanItem } from "./PlanItem";
import { Reasoning } from "./Reasoning";
import { ToolCall } from "./ToolCall";
import { ToolCallGroup } from "./ToolCallGroup";
import { UserMessage } from "./UserMessage";
import { WebSearchItem } from "./WebSearchItem";

interface ChatItemRowProps {
  threadId: string;
  entry: ChatTimelineEntry;
  /** True when this is the tail of the visible timeline. Drives live-group expand state. */
  isLastEntry?: boolean;
}

/**
 * Per-id store subscription: only re-renders when this row's `RuntimeChatItem`
 * reference changes (e.g. streaming deltas), not when other rows update.
 *
 * `memo`: `MessageList` re-renders whenever TanStack Virtual measures/relayouts
 * (expand/collapse, scroll). React Compiler does not guarantee skipping those
 * parent-driven passes for siblings — explicit memo isolates rows (AGENTS.md escape).
 */
export const ChatItemRow = memo(function ChatItemRow({
  threadId,
  entry,
  isLastEntry = false,
}: ChatItemRowProps) {
  "use no memo";
  if (entry.kind === "tool_call_group") {
    return <ToolCallGroup threadId={threadId} itemIds={entry.itemIds} isLive={isLastEntry} />;
  }
  return <SingleChatItemRow threadId={threadId} itemId={entry.id} />;
});

const SingleChatItemRow = memo(function SingleChatItemRow({
  threadId,
  itemId,
}: {
  threadId: string;
  itemId: string;
}) {
  const item = useAppStore(getRuntimeItemStoreSelector(threadId, itemId));
  if (import.meta.env.DEV && window.localStorage.getItem("lc-chat-debug-renders") === "1") {
    console.log("[lc-chat-debug] ChatItemRow render", {
      threadId,
      itemId,
      type: item?.type ?? "(missing)",
      state: item?.state ?? "(n/a)",
    });
  }
  if (!item) return null;
  return renderItem(item);
});

function renderItem(item: RuntimeChatItem) {
  switch (item.type) {
    case "user_message":
      return <UserMessage item={item} />;
    case "assistant_message":
      return <AssistantMessage item={item} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "plan":
      return <PlanItem item={item} />;
    case "command_execution":
      return <CommandExecution item={item} />;
    case "file_change":
      return <FileChange item={item} />;
    case "tool_call":
      return <ToolCall item={item} />;
    case "web_search":
      return <WebSearchItem item={item} />;
    case "error":
      return <ErrorItem item={item} />;
    default:
      return null;
  }
}
