import { startTransition, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Header, Label, ListBox, Popover, Tooltip } from "@heroui/react";
import type { LabeledOption } from "@/shared/contracts";
import { Button } from "../Button";

export interface EffortContextMenuProps {
  efforts: readonly LabeledOption[];
  effortValue?: string;
  onEffortChange?: (value: string) => void;
  contextSizes: readonly LabeledOption[];
  contextValue?: string;
  onContextChange?: (value: string) => void;
  /** Optional icon to show in the trigger (e.g., effort indicator). */
  icon?: ReactNode;
  isDisabled?: boolean;
  hideLabelOnWrap?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EffortContextMenu(props: EffortContextMenuProps) {
  const {
    efforts,
    effortValue,
    onEffortChange,
    contextSizes,
    contextValue,
    onContextChange,
    icon,
    isDisabled,
    hideLabelOnWrap,
    onOpenChange,
  } = props;

  const [isOpen, setIsOpen] = useState(false);

  const hasEffort = efforts.length > 0;
  const hasContext = contextSizes.length > 0;
  if (!hasEffort && !hasContext) return null;

  const effortLabel = hasEffort
    ? (efforts.find((o) => o.id === effortValue)?.label ?? effortValue ?? "")
    : "";
  const contextLabel = hasContext
    ? (contextSizes.find((o) => o.id === contextValue)?.label ?? contextValue ?? "")
    : "";

  const triggerLabel = [effortLabel, contextLabel].filter((p) => p.length > 0).join(" · ");

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    onOpenChange?.(open);
  }

  function handleEffort(id: string) {
    if (id === effortValue) return;
    startTransition(() => onEffortChange?.(id));
  }
  function handleContext(id: string) {
    if (id === contextValue) return;
    startTransition(() => onContextChange?.(id));
  }

  const trigger = (
    <Button
      aria-label="Effort and context"
      isDisabled={isDisabled ?? false}
      size="sm"
      variant="ghost"
      className="lightcode-composer-menu min-w-0 px-2.5"
    >
      {icon}
      <span className={hideLabelOnWrap ? "lightcode-composer-label-hideable truncate" : "truncate"}>
        {triggerLabel}
      </span>
      <ChevronDown
        className={
          hideLabelOnWrap
            ? "lightcode-composer-label-hideable size-3.5 text-muted"
            : "size-3.5 text-muted"
        }
      />
    </Button>
  );

  const columnCount = (hasEffort ? 1 : 0) + (hasContext ? 1 : 0);
  const popoverWidth = columnCount === 2 ? "w-72" : "w-44";

  return (
    <Popover isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        {hideLabelOnWrap ? (
          <Tooltip>
            {trigger}
            <Tooltip.Content placement="top">{triggerLabel}</Tooltip.Content>
          </Tooltip>
        ) : (
          trigger
        )}
      </Popover.Trigger>
      <Popover.Content placement="top start" className={`${popoverWidth} p-0`}>
        <Popover.Dialog className="flex max-h-[24rem] flex-col overflow-hidden">
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
          >
            {hasEffort ? (
              <Column
                label="Effort"
                options={efforts}
                value={effortValue}
                hasNeighbor={hasContext}
                onSelect={handleEffort}
              />
            ) : null}
            {hasContext ? (
              <Column
                label="Context"
                options={contextSizes}
                value={contextValue}
                hasNeighbor={false}
                onSelect={handleContext}
              />
            ) : null}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function Column(props: {
  label: string;
  options: readonly LabeledOption[];
  value: string | undefined;
  hasNeighbor: boolean;
  onSelect: (id: string) => void;
}) {
  const { label, options, value, hasNeighbor, onSelect } = props;
  return (
    <div className={hasNeighbor ? "border-r border-border" : ""}>
      <Header className="block border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/80">
        {label}
      </Header>
      <ListBox
        aria-label={label}
        className="max-h-60 overflow-y-auto !p-1 [&_.list-box-item]:min-h-7 [&_.list-box-item]:py-0.5 [&_.list-box-item]:pl-2 [&_.list-box-item]:pr-2"
        items={options as LabeledOption[]}
        selectedKeys={value ? new Set([value]) : new Set<string>()}
        selectionMode="single"
        disallowEmptySelection
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const sel = [...keys][0];
          if (typeof sel === "string") onSelect(sel);
        }}
      >
        {(option) => (
          <ListBox.Item
            id={option.id}
            textValue={option.label}
            className="focus-visible:outline-none"
          >
            <ListBox.ItemIndicator>
              {({ isSelected }) => (isSelected ? <Check className="size-3" /> : null)}
            </ListBox.ItemIndicator>
            <Label className="flex-1 truncate">{option.label}</Label>
          </ListBox.Item>
        )}
      </ListBox>
    </div>
  );
}
