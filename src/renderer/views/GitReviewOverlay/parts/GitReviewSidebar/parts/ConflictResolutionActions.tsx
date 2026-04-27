import { Sparkles } from "lucide-react";
import { Button } from "@heroui/react";
import { PixelLoader } from "@/renderer/components/common";
import { GitReviewSection } from "./GitReviewSection";

export function ConflictResolutionActions(props: {
  canResolveWithAgent: boolean;
  isAbortingMerge: boolean;
  onResolveWithAgent: () => void;
  onAbortMerge: () => Promise<void>;
}) {
  const { canResolveWithAgent, isAbortingMerge, onResolveWithAgent, onAbortMerge } = props;

  return (
    <GitReviewSection>
      <Button
        variant="tertiary"
        size="sm"
        className="w-full"
        isDisabled={!canResolveWithAgent || isAbortingMerge}
        onPress={onResolveWithAgent}
      >
        <Sparkles className="size-3.5" />
        Fix in Agent
      </Button>
      <Button
        variant="tertiary"
        size="sm"
        className="w-full text-danger hover:text-danger"
        isPending={isAbortingMerge}
        onPress={() => void onAbortMerge()}
      >
        {({ isPending }) => (
          <>
            {isPending && <PixelLoader size="xs" />}
            Abort Merge
          </>
        )}
      </Button>
    </GitReviewSection>
  );
}
