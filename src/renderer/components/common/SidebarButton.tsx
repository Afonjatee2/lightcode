import { useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
import { handleKeyActivate } from "@/renderer/utils/a11y";

export function SidebarButton(props: {
  ref?: React.Ref<HTMLDivElement>;
  icon: React.ReactNode;
  label: React.ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  isActive?: boolean;
  iconOnly?: boolean;
  tooltip?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
  onDoubleClick?: () => void;
  isDragging?: boolean;
  isDraggingAnything?: boolean;
  onContextMenu?: React.MouseEventHandler | undefined;
  liveText?: boolean;
}) {
  const {
    ref,
    icon,
    label,
    onPress,
    isDisabled = false,
    isActive = false,
    iconOnly = false,
    tooltip,
    suffix,
    className,
    onDoubleClick,
    isDragging,
    isDraggingAnything = false,
    onContextMenu,
    liveText = false,
  } = props;

  const labelRef = useRef<HTMLSpanElement>(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const inactiveText = liveText ? "text-foreground/85" : "text-muted";

  const stateClass =
    isDisabled || isDragging
      ? "cursor-not-allowed text-muted/40"
      : isActive && !isDraggingAnything
        ? "bg-white/[0.08] text-foreground"
        : `${inactiveText} ${!isDraggingAnything ? "hover:bg-white/[0.04] hover:text-foreground" : ""}`;

  if (iconOnly) {
    return (
      <Tooltip delay={150}>
        <Tooltip.Trigger>
          <button
            ref={ref as React.Ref<HTMLButtonElement>}
            className={`flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-3xl outline-none transition-colors focus-visible:focus-ring ${stateClass} ${className ?? ""}`}
            disabled={isDisabled}
            onClick={onPress}
            onContextMenu={onContextMenu}
            type="button"
          >
            {icon}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">{label}</Tooltip.Content>
      </Tooltip>
    );
  }

  const row = (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled || undefined}
      aria-grabbed={isDragging}
      className={`group relative flex w-full cursor-default items-center gap-2 rounded-3xl px-3 py-1.5 text-left text-sm outline-none transition-colors ${stateClass} ${className ?? ""}`}
      onClick={isDisabled ? undefined : onPress}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (isDisabled) return;
        handleKeyActivate(e, () => onPress?.());
      }}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <span ref={labelRef} className="block truncate">
          {label}
        </span>
      </div>
      {suffix && <div className="flex shrink-0 items-center gap-[3px]">{suffix}</div>}
    </div>
  );

  if (!tooltip) return row;

  return (
    <Tooltip
      delay={500}
      isOpen={isTooltipOpen}
      onOpenChange={(open) => {
        if (open) {
          const el = labelRef.current;
          if (el && el.scrollWidth > el.clientWidth) {
            setIsTooltipOpen(true);
          }
        } else {
          setIsTooltipOpen(false);
        }
      }}
    >
      <Tooltip.Trigger className="block w-full" tabIndex={-1} role="none">
        {row}
      </Tooltip.Trigger>
      <Tooltip.Content placement="right" showArrow className="max-w-[28rem] break-all text-xs">
        {tooltip}
      </Tooltip.Content>
    </Tooltip>
  );
}
