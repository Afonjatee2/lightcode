import { Bot, Check } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import {
  getChildItemIdsStoreSelector,
  getRuntimeItemStoreSelector,
  selectActiveSubAgentParentItemIds,
} from "../../chatPaneSelectors";
import { getRuntimeItemPayload } from "@/renderer/state/slices/runtimeEventSlice";
import type { ToolCallPayload } from "@/shared/contracts";
import { deriveToolDisplay } from "./toolDisplay";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import {
  ThreadDockHeader,
  ThreadDockList,
  ThreadDockRow,
  ThreadDockSection,
} from "../../../ThreadDockUI";

interface ActiveSubAgentTileProps {
  threadId: string;
}

export function ActiveSubAgentTile({ threadId }: ActiveSubAgentTileProps) {
  const ids = useAppStore((s) => selectActiveSubAgentParentItemIds(s, threadId));
  const completedCount = useAppStore(
    (s) =>
      ids.filter((id) => {
        const item = getRuntimeItemStoreSelector(threadId, id)(s);
        if (!item) return false;
        const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
        return item.state === "completed" && payload?.status !== "running";
      }).length,
  );

  if (ids.length === 0) return null;

  return (
    <ThreadDockSection placement="composer" collapsed={false}>
      <ThreadDockHeader
        icon={Bot}
        title="Subagents"
        countLabel={`${completedCount}/${ids.length}`}
      />
      <ThreadDockList placement="composer" collapsed={false}>
        {ids.map((id) => (
          <ActiveSubAgentRow key={id} threadId={threadId} itemId={id} />
        ))}
      </ThreadDockList>
    </ThreadDockSection>
  );
}

function ActiveSubAgentRow({ threadId, itemId }: { threadId: string; itemId: string }) {
  const item = useAppStore(getRuntimeItemStoreSelector(threadId, itemId));
  const childCount = useAppStore(getChildItemIdsStoreSelector(threadId, itemId)).length;
  const openSubAgent = useAppStore((s) => s.openSubAgent);

  if (!item) return null;
  const payload = getRuntimeItemPayload<ToolCallPayload>(item, "tool_call");
  if (!payload?.name) return null;

  const display = deriveToolDisplay(payload);
  const isRunning = item.state !== "completed" || payload?.status === "running";
  const isDone = !isRunning;
  const progress = payload?.progress;
  const stepCount = progress?.stepCount ?? childCount;

  return (
    <ThreadDockRow
      isActive={!isDone}
      isDone={isDone}
      title={display.title}
      onClick={() => openSubAgent(threadId, item.id)}
    >
      {isDone ? (
        <Check aria-label="completed" className="size-3.5 shrink-0 text-foreground-muted" />
      ) : (
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
          <PixelLoader size="xxs" className="text-foreground" />
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate leading-5 ${isDone ? "text-foreground-muted" : "text-foreground"}`}
      >
        {display.title}
      </span>
      {isRunning && (
        <span className="shrink-0 tabular-nums text-foreground-muted group-hover:opacity-100 opacity-80 transition-opacity">
          {progress?.lastToolName || progress?.description ? (
            <span className="mr-1.5 max-w-[20ch] truncate inline-block align-bottom">
              {progress?.lastToolName ?? progress?.description}
            </span>
          ) : null}
          <span>
            {stepCount} step{stepCount === 1 ? "" : "s"}
          </span>
        </span>
      )}
    </ThreadDockRow>
  );
}
