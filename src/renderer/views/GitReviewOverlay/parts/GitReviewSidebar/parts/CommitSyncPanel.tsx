import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Lock, Sparkles } from "lucide-react";
import { Button, ButtonGroup, Dropdown, Label, Tooltip } from "@heroui/react";
import { PixelLoader, TextArea } from "@/renderer/components/common";
import { useGitReviewSectionPadX } from "../gitReviewPadXContext";

export function CommitSyncPanel(props: {
  mergeConflicting: boolean;
  mergeConflictFiles: string[];
  hasAnyChanges: boolean;
  hasStagedChanges: boolean;
  hasRemote: boolean;
  needsPush: boolean;
  ahead: number;
  behind: number;
  commitMessage: string;
  setCommitMessage: (msg: string) => void;
  canCommitStaged: boolean;
  canCommitAll: boolean;
  canGenerateMessage: boolean;
  isCommitting: boolean;
  isGenerating: boolean;
  isSyncing: boolean;
  isPullingFromSource: boolean;
  isAbortingMerge: boolean;
  isFinishingMerge: boolean;
  showPullFromSource: boolean;
  sourceBranch: string | null;
  sourceAhead: number;
  handleCommit: (addAll: boolean) => Promise<void>;
  handleGenerateMessage: () => Promise<void>;
  handleSyncOrPush: () => Promise<void>;
  handlePullFromSource: () => Promise<void>;
  handleAbortMerge: () => Promise<void>;
  handleFinishMerge: () => Promise<void>;
}) {
  const {
    mergeConflicting,
    mergeConflictFiles,
    hasAnyChanges,
    hasStagedChanges,
    hasRemote,
    needsPush,
    ahead,
    behind,
    commitMessage,
    setCommitMessage,
    canCommitStaged,
    canCommitAll,
    canGenerateMessage,
    isCommitting,
    isGenerating,
    isSyncing,
    isPullingFromSource,
    isAbortingMerge,
    isFinishingMerge,
    showPullFromSource,
    sourceBranch,
    sourceAhead,
    handleCommit,
    handleGenerateMessage,
    handleSyncOrPush,
    handlePullFromSource,
    handleAbortMerge,
    handleFinishMerge,
  } = props;
  const sectionPadX = useGitReviewSectionPadX();

  return (
    <div className={`space-y-2 border-t border-white/6 pt-2 pb-1 ${sectionPadX}`}>
      {mergeConflicting && mergeConflictFiles.length === 0 ? (
        <>
          <p className="text-xs font-medium text-success">All conflicts resolved</p>
          <Button
            variant="primary"
            className="w-full"
            isPending={isFinishingMerge}
            isDisabled={isAbortingMerge}
            onPress={() => void handleFinishMerge()}
          >
            {({ isPending }) => (
              <>
                {isPending ? <PixelLoader size="xs" /> : <Check className="size-3.5" />}
                Finish Merge
              </>
            )}
          </Button>
          <Button
            variant="tertiary"
            className="w-full"
            isPending={isAbortingMerge}
            isDisabled={isFinishingMerge}
            onPress={() => void handleAbortMerge()}
          >
            {({ isPending }) => (
              <>
                {isPending && <PixelLoader size="xs" />}
                Abort Merge
              </>
            )}
          </Button>
        </>
      ) : hasAnyChanges ? (
        <>
          <div className="relative">
            <TextArea
              fullWidth
              autoSize
              maxRows={8}
              aria-label="Commit message"
              placeholder="Commit message (Ctrl+Enter)"
              rows={1}
              value={commitMessage}
              className={canGenerateMessage ? "pr-8" : ""}
              variant="secondary"
              disabled={isCommitting}
              onChange={(e) => {
                setCommitMessage(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (canCommitStaged) void handleCommit(!hasStagedChanges);
                }
              }}
            />
            {canGenerateMessage && (
              <Tooltip delay={0}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="absolute top-1.5 right-1 size-6 min-w-0"
                  isDisabled={isGenerating || !hasAnyChanges}
                  isPending={isGenerating}
                  onPress={() => void handleGenerateMessage()}
                >
                  {({ isPending }) =>
                    isPending ? <PixelLoader size="xs" /> : <Sparkles className="size-3.5" />
                  }
                </Button>
                <Tooltip.Content>Generate commit message</Tooltip.Content>
              </Tooltip>
            )}
          </div>

          <ButtonGroup className="w-full">
            <Button
              variant="tertiary"
              className="flex-1"
              isDisabled={!canCommitStaged}
              isPending={isCommitting}
              onPress={() => void handleCommit(!hasStagedChanges)}
            >
              {({ isPending }) => (
                <>
                  {isPending ? <PixelLoader size="xs" /> : <Lock className="size-3.5" />}
                  Commit
                </>
              )}
            </Button>
            <Dropdown>
              <Button
                isIconOnly
                variant="tertiary"
                aria-label="More commit options"
                isDisabled={!canCommitAll}
              >
                <ButtonGroup.Separator />
                <ChevronDown className="size-3.5" />
              </Button>
              <Dropdown.Popover placement="top end">
                <Dropdown.Menu
                  aria-label="Commit options"
                  onAction={(key) => {
                    if (key === "add-all-commit") void handleCommit(true);
                    if (key === "pull-from-source") void handlePullFromSource();
                  }}
                >
                  <Dropdown.Item id="add-all-commit" textValue="Add all + commit">
                    <Label>Add all + commit</Label>
                  </Dropdown.Item>
                  {showPullFromSource ? (
                    <Dropdown.Item
                      id="pull-from-source"
                      textValue={`Pull from ${sourceBranch} (${sourceAhead})`}
                      isDisabled={isPullingFromSource}
                    >
                      <ArrowDown className="size-3.5" />
                      <Label>
                        Pull from {sourceBranch} ({sourceAhead})
                      </Label>
                    </Dropdown.Item>
                  ) : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </ButtonGroup>
        </>
      ) : hasRemote ? (
        <>
          <Button
            variant="tertiary"
            className="w-full"
            isDisabled={isSyncing}
            isPending={isSyncing}
            onPress={() => void handleSyncOrPush()}
          >
            {({ isPending }) => (
              <>
                {isPending ? (
                  <PixelLoader size="xs" />
                ) : needsPush ? (
                  <ArrowUp className="size-3.5" />
                ) : (
                  <ArrowUpDown className="size-3.5" />
                )}
                {needsPush
                  ? `Push${ahead > 0 ? ` (${ahead})` : ""}`
                  : behind > 0 || ahead > 0
                    ? `Sync${behind > 0 ? ` ↓${behind}` : ""}${ahead > 0 ? ` ↑${ahead}` : ""}`
                    : "Sync"}
              </>
            )}
          </Button>
        </>
      ) : null}
    </div>
  );
}
