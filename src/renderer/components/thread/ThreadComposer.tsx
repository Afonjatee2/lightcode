import { ReactNode, useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { ToggleButton, Tooltip } from "@heroui/react";
import {
  Button,
  EffortContextMenu,
  OptionMenu,
  ProviderModelMenu,
  TextArea,
  type ProviderModelMenuProvider,
} from "@/renderer/components/common";
import { EffortIcon } from "@/renderer/components/providers/EffortIcon";
import { PermissionIcon } from "@/renderer/components/providers/PermissionIcon";
import type { LabeledOption } from "@/shared/contracts";

export type OptionMenuOption = string | { id: string; label: string; hint?: string };

/** Semantic icon kinds resolved automatically by the composer. */
export type ComposerIconKind = "effort" | "permission";

export type ComposerControl =
  | {
      kind?: "menu";
      value: string;
      options: readonly OptionMenuOption[];
      onChange?: (value: string) => void;
      icon?: ReactNode;
      iconKind?: ComposerIconKind;
      iconOnly?: boolean;
      placeholder?: string;
      isDisabled?: boolean;
      hideLabelOnWrap?: boolean;
    }
  | {
      kind: "toggle";
      label: string;
      icon?: ReactNode;
      iconKind?: ComposerIconKind;
      isSelected: boolean;
      onChange?: (isSelected: boolean) => void;
      isDisabled?: boolean;
      iconOnly?: boolean;
      hideLabelOnWrap?: boolean;
    }
  | {
      kind: "static";
      value: string;
      icon?: ReactNode;
      iconOnly?: boolean;
      hideLabelOnWrap?: boolean;
    }
  | {
      kind: "provider-model";
      providers: ProviderModelMenuProvider[];
      currentAgentKind: string;
      currentModel: string;
      lockedAgentKind?: string;
      isDisabled?: boolean;
      hideLabelOnWrap?: boolean;
      onChange: (next: { agentKind: string; model: string }) => void;
    }
  | {
      kind: "effort-context";
      efforts: readonly LabeledOption[];
      effortValue?: string;
      onEffortChange?: (value: string) => void;
      contextSizes: readonly LabeledOption[];
      contextValue?: string;
      onContextChange?: (value: string) => void;
      icon?: ReactNode;
      isDisabled?: boolean;
      hideLabelOnWrap?: boolean;
    };

function resolveIcon(control: ComposerControl): ReactNode | undefined {
  if (control.kind === "static") return control.icon;
  if (control.kind === "provider-model" || control.kind === "effort-context") {
    return undefined;
  }
  if (control.icon) return control.icon;
  const iconKind = control.iconKind;
  if (!iconKind) return undefined;

  if (iconKind === "effort" && control.kind !== "toggle") {
    const ids = control.options.map((o) => (typeof o === "string" ? o : o.id));
    return <EffortIcon className="size-4 text-foreground" effort={control.value} efforts={ids} />;
  }

  if (iconKind === "permission") {
    if (control.kind === "toggle") {
      return (
        <PermissionIcon
          className="size-4 text-foreground"
          index={control.isSelected ? 1 : 0}
          count={2}
        />
      );
    }
    const ids = control.options.map((o) => (typeof o === "string" ? o : o.id));
    const idx = ids.indexOf(control.value);
    return (
      <PermissionIcon
        className="size-4 text-foreground"
        index={idx < 0 ? 0 : idx}
        count={ids.length}
      />
    );
  }

  return undefined;
}

export function ThreadComposer(props: {
  autoFocus?: boolean;
  compact?: boolean;
  prompt: string;
  placeholder: string;
  fixedContent?: ReactNode;
  inputContent?: ReactNode;
  attachmentBar?: ReactNode;
  promptDisabled?: boolean;
  submitLabel: string;
  submitDisabled: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: (() => void) | undefined;
  controls: ComposerControl[];
  leadingControls?: ReactNode;
  afterControls?: ReactNode;
}) {
  const {
    autoFocus = false,
    compact = false,
    prompt,
    placeholder,
    fixedContent,
    inputContent,
    attachmentBar,
    promptDisabled = false,
    submitLabel,
    submitDisabled,
    onPromptChange,
    onSubmit,
    onStop,
    controls,
    leadingControls,
    afterControls,
  } = props;

  const [isWrapping, setIsWrapping] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);

  const returnFocusToInput = () => {
    const el = editorHostRef.current?.querySelector<HTMLElement>(
      'textarea, [contenteditable="true"], input:not([type="hidden"])',
    );
    // rAF lets MenuTrigger's own focus-return run first, then we override it.
    if (el) requestAnimationFrame(() => el.focus());
  };

  // Use a ref to track the current wrapping state to avoid unnecessary state updates
  const isWrappingRef = useRef(false);

  useEffect(() => {
    const check = () => {
      if (controlsRef.current && rulerRef.current) {
        const containerWidth = controlsRef.current.getBoundingClientRect().width;
        const preferredWidth = rulerRef.current.getBoundingClientRect().width;
        const shouldWrap = preferredWidth > containerWidth;

        if (shouldWrap !== isWrappingRef.current) {
          isWrappingRef.current = shouldWrap;
          setIsWrapping(shouldWrap);
        }
      }
    };

    const observer = new ResizeObserver(check);
    if (controlsRef.current) observer.observe(controlsRef.current);
    if (rulerRef.current) observer.observe(rulerRef.current);

    // Initial check
    check();

    return () => observer.disconnect();
  }, []); // Only setup once on mount

  // Also trigger a check when controls change (e.g. model name changes)
  // but without recreating the observer.
  useEffect(() => {
    if (controlsRef.current && rulerRef.current) {
      const containerWidth = controlsRef.current.getBoundingClientRect().width;
      const preferredWidth = rulerRef.current.getBoundingClientRect().width;
      const shouldWrap = preferredWidth > containerWidth;
      if (shouldWrap !== isWrappingRef.current) {
        isWrappingRef.current = shouldWrap;
        setIsWrapping(shouldWrap);
      }
    }
  }, [controls]);

  const editorClassName = compact
    ? "lightcode-composer-editor lightcode-composer-editor--compact"
    : "lightcode-composer-editor";
  const customInputClassName = compact
    ? "lightcode-composer-custom-input lightcode-composer-custom-input--compact"
    : "lightcode-composer-custom-input";
  const toolbarClassName = compact
    ? "lightcode-composer-toolbar lightcode-composer-toolbar--compact flex items-end justify-between gap-3"
    : "lightcode-composer-toolbar flex items-end justify-between gap-3";

  const renderControlsList = (forceShowLabels = false) =>
    controls.map((control, index) => {
      if (control.kind === "provider-model") {
        return (
          <ProviderModelMenu
            key={`provider-model-${index}`}
            providers={control.providers}
            currentAgentKind={control.currentAgentKind}
            currentModel={control.currentModel}
            {...(control.lockedAgentKind ? { lockedAgentKind: control.lockedAgentKind } : {})}
            {...(control.isDisabled !== undefined ? { isDisabled: control.isDisabled } : {})}
            {...(control.hideLabelOnWrap !== undefined
              ? { hideLabelOnWrap: control.hideLabelOnWrap && !forceShowLabels }
              : {})}
            onChange={control.onChange}
            onOpenChange={(open) => {
              if (!open) returnFocusToInput();
            }}
          />
        );
      }

      if (control.kind === "effort-context") {
        return (
          <EffortContextMenu
            key={`effort-context-${index}`}
            efforts={control.efforts}
            {...(control.effortValue !== undefined ? { effortValue: control.effortValue } : {})}
            {...(control.onEffortChange ? { onEffortChange: control.onEffortChange } : {})}
            contextSizes={control.contextSizes}
            {...(control.contextValue !== undefined ? { contextValue: control.contextValue } : {})}
            {...(control.onContextChange ? { onContextChange: control.onContextChange } : {})}
            {...(control.icon ? { icon: control.icon } : {})}
            {...(control.isDisabled !== undefined ? { isDisabled: control.isDisabled } : {})}
            {...(control.hideLabelOnWrap !== undefined
              ? { hideLabelOnWrap: control.hideLabelOnWrap && !forceShowLabels }
              : {})}
            onOpenChange={(open) => {
              if (!open) returnFocusToInput();
            }}
          />
        );
      }

      if (control.kind === "static") {
        const hideLabel = control.iconOnly || (control.hideLabelOnWrap && !forceShowLabels);
        const content = (
          <div
            key={`${control.value}-${index}`}
            className="lightcode-composer-static min-w-0 px-2.5"
          >
            {control.icon}
            {!control.iconOnly && (
              <span
                className={hideLabel ? "lightcode-composer-label-hideable truncate" : "truncate"}
              >
                {control.value}
              </span>
            )}
          </div>
        );

        if (control.iconOnly || (hideLabel && isWrapping)) {
          return (
            <Tooltip key={`static-tooltip-${index}`}>
              {content}
              <Tooltip.Content placement="top">{control.value}</Tooltip.Content>
            </Tooltip>
          );
        }

        return content;
      }

      if (control.kind === "toggle") {
        const hideLabel =
          control.iconOnly || (control.hideLabelOnWrap && !forceShowLabels && isWrapping);
        const toggle = (
          <ToggleButton
            key={`toggle-${index}`}
            aria-label={control.label}
            className={
              control.iconOnly
                ? "lightcode-composer-toggle min-w-9 px-2"
                : "lightcode-composer-toggle min-w-0 px-2.5"
            }
            isDisabled={control.isDisabled ?? false}
            isSelected={control.isSelected}
            size="sm"
            variant="ghost"
            onChange={control.onChange ?? (() => undefined)}
          >
            {resolveIcon(control)}
            {!control.iconOnly && (
              <span
                className={
                  control.hideLabelOnWrap && !forceShowLabels
                    ? "lightcode-composer-label-hideable"
                    : undefined
                }
              >
                {control.label}
              </span>
            )}
          </ToggleButton>
        );

        if (hideLabel) {
          return (
            <Tooltip key={`toggle-tooltip-${index}`}>
              {toggle}
              <Tooltip.Content placement="top">{control.label}</Tooltip.Content>
            </Tooltip>
          );
        }

        return toggle;
      }

      const resolvedIcon = resolveIcon(control);
      const optionalProps = {
        ...(resolvedIcon ? { icon: resolvedIcon } : {}),
        ...(control.iconOnly ? { iconOnly: control.iconOnly } : {}),
        ...(control.placeholder ? { placeholder: control.placeholder } : {}),
        ...(control.isDisabled !== undefined ? { isDisabled: control.isDisabled } : {}),
        ...(control.hideLabelOnWrap !== undefined
          ? {
              hideLabelOnWrap: control.hideLabelOnWrap && !forceShowLabels,
              tooltip:
                control.hideLabelOnWrap && !forceShowLabels && isWrapping
                  ? control.value
                  : undefined,
            }
          : {}),
      };

      return (
        <OptionMenu
          key={`${control.value}-${index}`}
          buttonVariant="ghost"
          className="lightcode-composer-menu min-w-0 px-2.5"
          options={control.options}
          value={control.value}
          onChange={control.onChange ?? (() => undefined)}
          onOpenChange={(open) => {
            if (!open) returnFocusToInput();
          }}
          {...optionalProps}
        />
      );
    });

  const renderControls = () => (
    <div className="relative flex-1 min-w-0">
      {/* Ruler: hidden, non-wrapping, full labels */}
      <div
        ref={rulerRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 flex flex-nowrap items-center gap-1 opacity-0"
        style={{ visibility: "hidden", whiteSpace: "nowrap" }}
      >
        {renderControlsList(true)}
      </div>

      {/* Real Controls: wraps and respects isWrapping state.
         Fixed height + overflow-hidden prevents a visible two-row blink
         while labels collapse — wrapped items are clipped, not shown. */}
      <div
        ref={controlsRef}
        className={`flex min-w-0 flex-wrap items-center gap-1 overflow-hidden ${isWrapping ? "is-wrapping" : ""}`}
        style={{ height: "2.25rem" }}
      >
        {renderControlsList()}
      </div>
    </div>
  );

  const renderEditor = () =>
    inputContent ? (
      <div className={customInputClassName}>{inputContent}</div>
    ) : (
      <TextArea
        autoFocus={autoFocus} // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
        fullWidth
        className={editorClassName}
        disabled={promptDisabled}
        placeholder={placeholder}
        rows={1}
        value={prompt}
        variant="secondary"
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    );

  const renderSendButton = () => {
    // When the agent is running and input is empty, show stop button
    if (onStop && submitDisabled) {
      return (
        <Tooltip delay={0}>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              aria-label="Stop response"
              className="lightcode-composer-send"
              onPress={onStop}
              size="sm"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Stop response</Tooltip.Content>
        </Tooltip>
      );
    }
    return (
      <Button
        isIconOnly
        aria-label={submitLabel}
        className="lightcode-composer-send"
        isDisabled={submitDisabled || promptDisabled}
        onPress={onSubmit}
        size="sm"
      >
        <ArrowUp className="size-4" />
      </Button>
    );
  };

  return (
    <div>
      <div className="lightcode-composer-shell overflow-hidden">
        {fixedContent}
        {attachmentBar}
        <div ref={editorHostRef}>{renderEditor()}</div>
        <div className={toolbarClassName}>
          {leadingControls ? (
            <div className="flex shrink-0 items-end gap-2">{leadingControls}</div>
          ) : null}
          {renderControls()}
          <div className="flex items-end gap-2">
            {afterControls}
            {renderSendButton()}
          </div>
        </div>
      </div>
    </div>
  );
}
