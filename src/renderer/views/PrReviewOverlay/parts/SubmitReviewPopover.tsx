import { useState } from "react";
import {
  Button,
  Description,
  Label,
  Popover,
  Radio,
  RadioGroup,
  TextArea,
  toast,
} from "@heroui/react";
import { Check, MessageSquare, X } from "lucide-react";
import type { PrReviewDecision, ProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { readBridge } from "@/renderer/bridge";

export function SubmitReviewPopover(props: {
  projectLocation: ProjectLocation;
  prNumber: number;
  /** Hide the trigger when the viewer authored the PR (GitHub disallows self-review). */
  hidden?: boolean;
  onSubmitted: () => void;
}) {
  const { projectLocation, prNumber, hidden, onSubmitted } = props;
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<PrReviewDecision>("comment");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requiresBody = decision !== "approve";
  const bodyEmpty = body.trim().length === 0;

  if (hidden) return null;

  async function handleSubmit() {
    if (requiresBody && bodyEmpty) return;
    setSubmitting(true);
    try {
      await readBridge().ghSubmitPrReview({
        projectLocation,
        prNumber,
        decision,
        body,
      });
      toast.success(
        decision === "approve"
          ? "Approved"
          : decision === "request-changes"
            ? "Changes requested"
            : "Comment posted",
      );
      setOpen(false);
      setBody("");
      setDecision("comment");
      onSubmitted();
    } catch (err) {
      toast.danger(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const options: {
    value: PrReviewDecision;
    label: string;
    description: string;
    icon: typeof Check;
  }[] = [
    {
      value: "comment",
      label: "Comment",
      description: "Submit feedback without explicit approval.",
      icon: MessageSquare,
    },
    {
      value: "approve",
      label: "Approve",
      description: "Submit feedback and approve merging these changes.",
      icon: Check,
    },
    {
      value: "request-changes",
      label: "Request changes",
      description: "Submit feedback that must be addressed before merging.",
      icon: X,
    },
  ];

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="primary"
        className="h-5 min-h-0 gap-1 bg-success px-2 text-[11px] font-medium text-success-foreground hover:bg-success/90"
        onPress={() => setOpen(true)}
      >
        <Check className="size-3" />
        Submit review
      </Button>
      <Popover.Content className="w-[340px]">
        <Popover.Dialog>
          <Popover.Heading>Finish your review</Popover.Heading>
          <div className="mt-2 flex flex-col gap-3">
            <TextArea
              aria-label="Review comment"
              className="h-20 w-full text-xs"
              placeholder="Leave a comment"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={submitting}
            />
            <RadioGroup
              aria-label="Review decision"
              className="gap-1.5"
              value={decision}
              onChange={(v) => setDecision(v as PrReviewDecision)}
            >
              {options.map(({ value, label, description, icon: Icon }) => (
                <Radio key={value} value={value} className="items-start">
                  <Radio.Control className="mt-0.5">
                    <Radio.Indicator />
                  </Radio.Control>
                  <Radio.Content>
                    <div className="flex items-center gap-1.5">
                      <Icon className="size-3.5 shrink-0 text-muted" />
                      <Label className="text-xs font-medium">{label}</Label>
                    </div>
                    <Description className="text-[11px] text-muted">{description}</Description>
                  </Radio.Content>
                </Radio>
              ))}
            </RadioGroup>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="tertiary"
                size="sm"
                onPress={() => setOpen(false)}
                isDisabled={submitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="bg-success text-success-foreground hover:bg-success/90"
                onPress={() => void handleSubmit()}
                isPending={submitting}
                isDisabled={submitting || (requiresBody && bodyEmpty)}
              >
                Submit review
              </Button>
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
