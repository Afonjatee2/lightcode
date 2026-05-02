import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PixelLoader } from "@/renderer/components/common";
import { Dropdown, Label, Tooltip } from "@heroui/react";
import { useShallow } from "zustand/shallow";
import { useGitStore } from "@/renderer/state/gitStore";
import { useAppStore } from "@/renderer/state/appStore";
import { readBridge } from "@/renderer/bridge";
import { buildWorktreeLocation } from "@/shared/worktree";
import { handleKeyActivate } from "@/renderer/utils/a11y";
import type { ProjectLocation } from "@/shared/contracts";
import type { SyncAction } from "./useWorktreeActions";

function deriveSyncAction(hasTracking: boolean, ahead: number, behind: number): SyncAction {
  if (!hasTracking) return "push";
  if (ahead > 0 && behind === 0) return "push";
  if (behind > 0 && ahead === 0) return "pull";
  return "sync";
}

type MenuKey = "pull" | "pullRebase" | "push" | "sync" | "syncRebase" | "fetch";

export function SyncBadge(props: { projectId: string; worktreePath?: string }) {
  const { ahead, behind, hasTracking, hasRemote } = useGitStore(
    useShallow((s) => {
      const status = props.worktreePath
        ? s.worktreeStatuses[props.worktreePath]
        : s.statuses[props.projectId];
      return {
        ahead: status?.ahead ?? 0,
        behind: status?.behind ?? 0,
        hasTracking: Boolean(status?.tracking),
        hasRemote: status?.hasRemote ?? false,
      };
    }),
  );

  const [isSyncing, setIsSyncing] = useState(false);

  if (ahead === 0 && behind === 0) return null;
  if (!hasRemote) return null;

  const syncAction = deriveSyncAction(hasTracking, ahead, behind);

  const label =
    syncAction === "push"
      ? `Push ↑${ahead}`
      : syncAction === "pull"
        ? `Pull ↓${behind}`
        : `Sync ↓${behind} ↑${ahead}`;

  function resolveLocation(): ProjectLocation | null {
    const project = useAppStore.getState().projects.find((p) => p.id === props.projectId);
    if (!project) return null;
    return props.worktreePath
      ? buildWorktreeLocation(project.location, props.worktreePath)
      : project.location;
  }

  async function runOp(op: () => Promise<void>) {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await op();
      const location = resolveLocation();
      if (!location) return;
      const newStatus = await readBridge().getGitStatus({ projectLocation: location });
      if (props.worktreePath) {
        useGitStore.getState().setWorktreeStatus(props.worktreePath, newStatus);
      } else {
        useGitStore.getState().setProjectSnapshot(props.projectId, { status: newStatus });
      }
    } catch {
      // Errors will be visible via git status refresh
    } finally {
      setIsSyncing(false);
    }
  }

  async function doPush() {
    const location = resolveLocation();
    if (!location) return;
    if (props.worktreePath) {
      const thread = useAppStore
        .getState()
        .threads.find((t) => t.worktreePath === props.worktreePath && t.worktreeBranch);
      await readBridge().gitPush({
        projectLocation: location,
        remote: "origin",
        branch: thread?.worktreeBranch ?? undefined,
        setUpstream: true,
      });
    } else {
      await readBridge().gitPush({
        projectLocation: location,
        setUpstream: !hasTracking,
      });
    }
  }

  async function handlePrimary() {
    if (syncAction === "push") {
      await runOp(doPush);
    } else if (syncAction === "pull") {
      await runOp(async () => {
        const location = resolveLocation();
        if (!location) return;
        await readBridge().gitPull({ projectLocation: location });
      });
    } else {
      await runOp(async () => {
        const location = resolveLocation();
        if (!location) return;
        await readBridge().gitSync({ projectLocation: location });
      });
    }
  }

  function handleMenuAction(key: MenuKey) {
    void runOp(async () => {
      const location = resolveLocation();
      if (!location) return;
      switch (key) {
        case "pull":
          await readBridge().gitPull({ projectLocation: location });
          break;
        case "pullRebase":
          await readBridge().gitPullRebase({ projectLocation: location });
          break;
        case "push":
          await doPush();
          break;
        case "sync":
          await readBridge().gitSync({ projectLocation: location });
          break;
        case "syncRebase":
          await readBridge().gitSyncRebase({ projectLocation: location });
          break;
        case "fetch":
          await readBridge().gitFetch({
            projectLocation: location,
            remote: "origin",
            prune: false,
          });
          break;
      }
    });
  }

  const badgeBase =
    "shrink-0 cursor-default rounded transition-colors text-muted/60 hover:bg-white/[0.04] hover:text-foreground";

  return (
    <span className="inline-flex items-center">
      <Tooltip delay={300}>
        <Tooltip.Trigger>
          <div
            role="button"
            tabIndex={0}
            aria-label={label}
            className={`${badgeBase} px-1 py-0.5`}
            onClick={(e) => {
              e.stopPropagation();
              void handlePrimary();
            }}
            onKeyDown={(e) =>
              handleKeyActivate(e, () => void handlePrimary(), { stopPropagation: true })
            }
          >
            <span className="flex items-center text-[10px] font-medium">
              {isSyncing ? (
                <PixelLoader size="xs" />
              ) : (
                <>
                  {behind > 0 && <span className="text-accent">↓{behind}</span>}
                  {ahead > 0 && <span className="text-accent">↑{ahead}</span>}
                </>
              )}
            </span>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip>

      <Dropdown>
        <Dropdown.Trigger>
          <div
            role="button"
            tabIndex={0}
            aria-label="More sync options"
            className={`${badgeBase} ml-0.5 px-0.5 py-0.5`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ChevronDown className="size-3" />
          </div>
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu onAction={(key) => handleMenuAction(key as MenuKey)}>
            <Dropdown.Item id="pull" textValue="Pull" isDisabled={!hasTracking}>
              <Label>Pull</Label>
            </Dropdown.Item>
            <Dropdown.Item id="pullRebase" textValue="Pull (Rebase)" isDisabled={!hasTracking}>
              <Label>Pull (Rebase)</Label>
            </Dropdown.Item>
            <Dropdown.Item id="push" textValue="Push">
              <Label>Push</Label>
            </Dropdown.Item>
            <Dropdown.Item id="sync" textValue="Sync" isDisabled={!hasTracking}>
              <Label>Sync</Label>
            </Dropdown.Item>
            <Dropdown.Item id="syncRebase" textValue="Sync (Rebase)" isDisabled={!hasTracking}>
              <Label>Sync (Rebase)</Label>
            </Dropdown.Item>
            <Dropdown.Item id="fetch" textValue="Fetch">
              <Label>Fetch</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </span>
  );
}
