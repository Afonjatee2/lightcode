import { GitMerge, Sparkles } from "lucide-react";
import { Button } from "@heroui/react";
import { PixelLoader } from "@/renderer/components/common";
import { useGitReviewSectionPadX } from "../gitReviewPadXContext";

export function ConflictResolutionActions(props: {
  canResolveWithAgent: boolean;
  isRunningMergetool: boolean;
  isAbortingMerge: boolean;
  onResolveWithAgent: () => void;
  onRunMergetool: () => Promise<void>;
  onAbortMerge: () => Promise<void>;
}) {
  const {
    canResolveWithAgent,
    isRunningMergetool,
    isAbortingMerge,
    onResolveWithAgent,
    onRunMergetool,
    onAbortMerge,
  } = props;
  const sectionPadX = useGitReviewSectionPadX();

  return (
    <div className={`space-y-2 border-t border-warning/30 pt-2 pb-2 ${sectionPadX}`}>
      <div className="flex gap-1.5">
        <Button
          variant="tertiary"
          size="sm"
          className="flex-1"
          isDisabled={!canResolveWithAgent || isRunningMergetool || isAbortingMerge}
          onPress={onResolveWithAgent}
        >
          <Sparkles className="size-3.5" />
          Agent
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          className="flex-1"
          isPending={isRunningMergetool}
          isDisabled={isAbortingMerge}
          onPress={() => void onRunMergetool()}
        >
          {({ isPending }) => (
            <>
              {isPending ? <PixelLoader size="xs" /> : <GitMerge className="size-3.5" />}
              Mergetool
            </>
          )}
        </Button>
      </div>
      <Button
        variant="tertiary"
        size="sm"
        className="w-full"
        isPending={isAbortingMerge}
        isDisabled={isRunningMergetool}
        onPress={() => void onAbortMerge()}
      >
        {({ isPending }) => (
          <>
            {isPending && <PixelLoader size="xs" />}
            Abort Merge
          </>
        )}
      </Button>
    </div>
  );
}
