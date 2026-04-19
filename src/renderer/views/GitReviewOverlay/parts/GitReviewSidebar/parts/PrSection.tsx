import { ChevronDown, ExternalLink, GitMerge } from "lucide-react";
import { Button, ButtonGroup, Dropdown, Label } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { PixelLoader } from "@/renderer/components/common";
import {
  usePrChecksStatus,
  usePrNumber,
  usePrState,
  usePrTitle,
  usePrUrl,
} from "@/renderer/state/gitSelectors";

export function PrSection(props: {
  prKey: string;
  prLoading: boolean;
  handleMergePr: (method: "merge" | "squash" | "rebase") => Promise<void>;
  handleClosePr: () => Promise<void>;
}) {
  const { prKey, prLoading, handleMergePr, handleClosePr } = props;
  const state = usePrState(prKey);
  const number = usePrNumber(prKey);
  const title = usePrTitle(prKey);
  const url = usePrUrl(prKey);
  const checksStatus = usePrChecksStatus(prKey);

  const indicatorColor =
    state === "merged"
      ? "bg-purple-400"
      : state === "draft"
        ? "bg-gray-400"
        : checksStatus === "FAILURE" || checksStatus === "ERROR"
          ? "bg-danger"
          : checksStatus === "PENDING"
            ? "bg-warning"
            : "bg-success";

  const displayTitle =
    title || (state === "draft" ? "Draft" : state === "merged" ? "Merged" : "Open");

  return (
    <div className="space-y-2 border-t border-white/6 px-3 pt-2">
      <div className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${indicatorColor}`} />
        <span className="min-w-0 truncate text-xs text-foreground" title={title || undefined}>
          <span className="text-muted">#{number}</span> {displayTitle}
        </span>
      </div>
      <Button
        variant="tertiary"
        className="w-full"
        onPress={() => url && void readBridge().openExternal(url)}
      >
        <ExternalLink className="size-3.5" />
        Open in Browser
      </Button>
      {state !== "merged" && (
        <ButtonGroup className="w-full">
          <Button
            variant="tertiary"
            className="flex-1"
            isDisabled={prLoading}
            isPending={prLoading}
            onPress={() => void handleMergePr("squash")}
          >
            {({ isPending }) => (
              <>
                {isPending ? <PixelLoader size="sm" /> : <GitMerge className="size-3.5" />}
                Merge PR
              </>
            )}
          </Button>
          <Dropdown>
            <Button isIconOnly variant="tertiary" aria-label="Merge options" isDisabled={prLoading}>
              <ButtonGroup.Separator />
              <ChevronDown className="size-3.5" />
            </Button>
            <Dropdown.Popover placement="top end">
              <Dropdown.Menu
                aria-label="Merge method"
                onAction={(key) => void handleMergePr(key as "merge" | "squash" | "rebase")}
              >
                <Dropdown.Item id="merge" textValue="Merge commit">
                  <Label>Merge commit</Label>
                </Dropdown.Item>
                <Dropdown.Item id="squash" textValue="Squash and merge">
                  <Label>Squash and merge</Label>
                </Dropdown.Item>
                <Dropdown.Item id="rebase" textValue="Rebase and merge">
                  <Label>Rebase and merge</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
      )}
      {state !== "merged" && (
        <Button
          variant="tertiary"
          className="w-full text-danger"
          isDisabled={prLoading}
          onPress={() => void handleClosePr()}
        >
          Close PR
        </Button>
      )}
    </div>
  );
}
