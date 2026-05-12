import {
  getRuntimeItemPayload,
  type RuntimeChatItem,
} from "@/renderer/state/slices/runtimeEventSlice";
import type { ToolCallPayload } from "@/shared/contracts";
import { memo, type ReactNode } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getChildItemIdsStoreSelector,
  getRuntimeItemStoreSelector,
  type ChatTimelineEntry,
} from "../../chatPaneSelectors";
import { AssistantMessage } from "./AssistantMessage";
import { CommandExecution } from "./CommandExecution";
import { FileChange } from "./FileChange";
import { PlanItem } from "./PlanItem";
import { Reasoning } from "./Reasoning";
import { SubAgentToolCall } from "./SubAgentToolCall";
import { ToolCall } from "./ToolCall";
import { ToolCallGroup } from "./ToolCallGroup";
import { UserMessage } from "./UserMessage";
import { WebSearchItem } from "./WebSearchItem";
import { isSubAgentTool } from "./toolDisplay";

interface ChatItemRowProps {
  threadId: string;
  entry: ChatTimelineEntry;
  /** True when this is the tail of the visible timeline. Drives live-group expand state. */
  isLastEntry?: boolean;
  checkpointRevertControl: ReactNode | null;
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
  checkpointRevertControl,
}: ChatItemRowProps) {
  "use no memo";
  if (entry.kind === "tool_call_group") {
    return <ToolCallGroup threadId={threadId} itemIds={entry.itemIds} isLive={isLastEntry} />;
  }
  return (
    <SingleChatItemRow
      threadId={threadId}
      itemId={entry.id}
      checkpointRevertControl={checkpointRevertControl}
    />
  );
});

const SingleChatItemRow = memo(function SingleChatItemRow({
  threadId,
  itemId,
  checkpointRevertControl,
}: {
  threadId: string;
  itemId: string;
  checkpointRevertControl: ReactNode | null;
}) {
  const item = useAppStore(getRuntimeItemStoreSelector(threadId, itemId));
  const childIds = useAppStore(getChildItemIdsStoreSelector(threadId, itemId));
  if (import.meta.env.DEV && window.localStorage.getItem("lc-chat-debug-renders") === "1") {
    console.log("[lc-chat-debug] ChatItemRow render", {
      threadId,
      itemId,
      type: item?.type ?? "(missing)",
      state: item?.state ?? "(n/a)",
    });
  }
  if (!item) return null;
  if (item.type === "tool_call") {
    const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
    if (childIds.length > 0 || isSubAgentTool(payload)) {
      return <SubAgentToolCall threadId={threadId} item={item} />;
    }
  }
  return renderItem(item, checkpointRevertControl);
});

function renderItem(item: RuntimeChatItem, checkpointRevertControl: ReactNode | null) {
  switch (item.type) {
    case "user_message":
      return <UserMessage item={item} checkpointRevertControl={checkpointRevertControl} />;
    case "assistant_message":
      return <AssistantMessage item={item} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "plan":
      return <PlanItem item={item} />;
    case "goal":
      return null;
    case "command_execution":
      return <CommandExecution item={item} />;
    case "file_change":
      return <FileChange item={item} />;
    case "tool_call":
      return <ToolCall item={item} />;
    case "web_search":
      return <WebSearchItem item={item} />;
    case "error":
      return null;
    default:
      return null;
  }
}
