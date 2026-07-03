import { useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import type { Key, Selection } from "@heroui/react";
import { Dropdown, Label, Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common";
import type { ComposerMcpServerDescriptor } from "./composerMcpServers";

export type ComposerMcpMenuItem = {
  descriptor: ComposerMcpServerDescriptor;
  enabled: boolean;
  visible: boolean;
  onToggle: (next: boolean) => void;
};

/**
 * Presentational switch used inside the MCP submenu rows. The row itself is a
 * `menuitemcheckbox` (multiple-selection menu), so the accessible checked state
 * comes from selection — this visual is `aria-hidden`. Matches the switch look
 * used by `EffortContextMenu`.
 */
function MenuSwitch(props: { checked: boolean }) {
  const { checked } = props;
  return (
    <span
      aria-hidden
      className={`relative ms-auto h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? "bg-success" : "bg-surface-tertiary"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}

export function ComposerAddMenu(props: {
  mcpServers: readonly ComposerMcpMenuItem[];
  onPickFiles: () => void;
}) {
  const { mcpServers, onPickFiles } = props;
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const visibleMcpServers = mcpServers.filter((server) => server.visible);

  const enabledKeys = new Set(
    visibleMcpServers.filter((server) => server.enabled).map((server) => server.descriptor.id),
  );

  const handleRootAction = (key: Key) => {
    if (String(key) === "file") {
      setIsOpen(false);
      onPickFiles();
    }
  };

  // Multiple-selection menu → toggling a row keeps the submenu (and the whole
  // "+" menu) open. Diff the new selection against current state to fire the
  // single toggle that changed.
  const handleMcpSelection = (keys: Selection) => {
    for (const server of visibleMcpServers) {
      const next = keys !== "all" && keys.has(server.descriptor.id);
      if (next !== server.enabled) server.onToggle(next);
    }
  };

  const button = (
    <Button
      isIconOnly
      aria-label={t`Add attachment or capability`}
      className="lightcode-composer-menu min-w-9 px-2"
      size="sm"
      variant="ghost"
    >
      <Plus className="size-4" />
    </Button>
  );

  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dropdown.Trigger>
        <Tooltip delay={300}>
          {button}
          <Tooltip.Content placement="top">
            <Trans>Add</Trans>
          </Tooltip.Content>
        </Tooltip>
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top">
        <Dropdown.Menu aria-label={t`Add to composer`} onAction={handleRootAction}>
          <Dropdown.Item id="file" textValue={t`File`} className="focus-visible:outline-none">
            <Paperclip className="size-4 text-muted" />
            <Label className="flex-1 truncate">
              <Trans>File</Trans>
            </Label>
            <span className="ms-auto truncate text-xs text-muted">
              <Trans>Attach</Trans>
            </span>
          </Dropdown.Item>
          {visibleMcpServers.length > 0 ? (
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item
                id="mcp-servers"
                textValue={t`MCP servers`}
                className="focus-visible:outline-none"
              >
                <Label className="flex-1 truncate">
                  <Trans>MCP servers</Trans>
                </Label>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label={t`MCP servers`}
                  selectionMode="multiple"
                  selectedKeys={enabledKeys}
                  onSelectionChange={handleMcpSelection}
                >
                  {visibleMcpServers.map((server) => {
                    const Icon = server.descriptor.icon;
                    const label = t(server.descriptor.label);
                    return (
                      <Dropdown.Item
                        key={server.descriptor.id}
                        id={server.descriptor.id}
                        textValue={label}
                        className="min-w-52 focus-visible:outline-none data-[selected=true]:bg-transparent"
                      >
                        <Icon className="size-4 text-muted" />
                        <Label className="flex-1 truncate">{label}</Label>
                        <MenuSwitch checked={server.enabled} />
                      </Dropdown.Item>
                    );
                  })}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
