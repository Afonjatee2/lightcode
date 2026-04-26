import { CheckCircle2, ChevronDown, ExternalLink, GitMerge } from "lucide-react";
import { Button, ButtonGroup, Dropdown, Label, Link, Separator } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { PixelLoader } from "@/renderer/components/common";
import {
  usePrChecksStatus,
  usePrNumber,
  usePrState,
  usePrTitle,
  usePrUrl,
} from "@/renderer/state/gitSelectors";
import { getPrStatusTone, PR_TONE_BG_CLASS } from "@/renderer/utils/prStatus";
import { useGitReviewSectionPadX } from "../gitReviewPadXContext";

export function PrSection(props: {
  prKey: string;
  prLoading: boolean;
  handleMergePr: (method: "merge" | "squash" | "rebase") => Promise<void>;
  handleClosePr: () => Promise<void>;
  handleMarkPrReady: () => Promise<void>;
}) {
  const { prKey, prLoading, handleMergePr, handleClosePr, handleMarkPrReady } = props;
  const state = usePrState(prKey);
  const number = usePrNumber(prKey);
  const title = usePrTitle(prKey);
  const url = usePrUrl(prKey);
  const checksStatus = usePrChecksStatus(prKey);

  const indicatorColor = PR_TONE_BG_CLASS[getPrStatusTone(state, checksStatus)];

  const stateBadge = state === "draft" ? "(Draft)" : "";
  const fallbackTitle = title || (state === "merged" ? "Merged" : state === "draft" ? "" : "Open");
  const sectionPadX = useGitReviewSectionPadX();

  return (
    <div className={`space-y-2 border-t border-white/6 pt-2 ${sectionPadX}`}>
      <div className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${indicatorColor}`} />
        <Link
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-tight text-muted no-underline hover:text-foreground hover:underline focus-visible:text-primary focus-visible:underline"
          isDisabled={!url}
          onPress={() => url && void readBridge().openExternal(url)}
        >
          <span className="min-w-0 truncate leading-tight" title={title || undefined}>
            #{number}
            {stateBadge}
            {fallbackTitle ? ` - ${fallbackTitle}` : ""}
          </span>
          <ExternalLink className="size-4 shrink-0" />
        </Link>
      </div>
      {state === "draft" && (
        <ButtonGroup className="w-full">
          <Button
            variant="tertiary"
            className="flex-1"
            isDisabled={prLoading}
            isPending={prLoading}
            onPress={() => void handleMarkPrReady()}
          >
            {({ isPending }) => (
              <>
                {isPending ? <PixelLoader size="sm" /> : <CheckCircle2 className="size-3.5" />}
                Ready for Review
              </>
            )}
          </Button>
          <Dropdown>
            <Button
              isIconOnly
              variant="tertiary"
              aria-label="More PR actions"
              isDisabled={prLoading}
            >
              <ButtonGroup.Separator />
              <ChevronDown className="size-3.5" />
            </Button>
            <Dropdown.Popover placement="top end">
              <Dropdown.Menu
                aria-label="PR actions"
                onAction={(key) => {
                  if (key === "close") void handleClosePr();
                }}
              >
                <Dropdown.Item id="close" textValue="Close PR" variant="danger">
                  <Label>Close PR</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
      )}
      {state !== "merged" && state !== "draft" && (
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
                Merge PR: Squash
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
                onAction={(key) => {
                  if (key === "close") void handleClosePr();
                  else void handleMergePr(key as "merge" | "squash" | "rebase");
                }}
              >
                <Dropdown.Item id="merge" textValue="Merge PR: Commit">
                  <Label>Merge PR: Commit</Label>
                </Dropdown.Item>
                <Dropdown.Item id="rebase" textValue="Merge PR: Rebase">
                  <Label>Merge PR: Rebase</Label>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item id="close" textValue="Close PR" variant="danger">
                  <Label>Close PR</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </ButtonGroup>
      )}
    </div>
  );
}
