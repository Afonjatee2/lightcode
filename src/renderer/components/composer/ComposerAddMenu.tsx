import { useState } from "react";
import { Paperclip, Plus } from "lucide-react";
import { Header, Label, ListBox, Popover, Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common";
import type { ComposerMcpServerDescriptor } from "./composerMcpServers";

export type ComposerMcpMenuItem = {
  descriptor: ComposerMcpServerDescriptor;
  enabled: boolean;
  visible: boolean;
  onToggle: (next: boolean) => void;
};

export function ComposerAddMenu(props: {
  mcpServers: readonly ComposerMcpMenuItem[];
  onPickFiles: () => void;
}) {
  const { mcpServers, onPickFiles } = props;
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const visibleMcpServers = mcpServers.filter((server) => server.visible);

  const handleSelect = (id: string) => {
    setIsOpen(false);
    if (id === "file") {
      onPickFiles();
      return;
    }
    const server = visibleMcpServers.find((entry) => entry.descriptor.id === id);
    if (server) server.onToggle(!server.enabled);
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
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger>
        <Tooltip delay={300}>
          {button}
          <Tooltip.Content placement="top">
            <Trans>Add</Trans>
          </Tooltip.Content>
        </Tooltip>
      </Popover.Trigger>
      {isOpen ? (
        <Popover.Content placement="top" className="p-0">
          <Popover.Dialog className="overflow-hidden">
            <ListBox
              aria-label={t`Add to composer`}
              className="lightcode-menu max-h-60 overflow-y-auto"
              selectionMode="none"
              onAction={(key) => handleSelect(String(key))}
            >
              <ListBox.Item id="file" textValue={t`File`} className="focus-visible:outline-none">
                <Paperclip className="size-4 text-muted" />
                <Label className="flex-1 truncate">
                  <Trans>File</Trans>
                </Label>
                <span className="ms-auto truncate text-xs text-muted">
                  <Trans>Attach</Trans>
                </span>
              </ListBox.Item>
              {visibleMcpServers.length > 0 ? (
                <ListBox.Item
                  id="mcp-servers-header"
                  isDisabled
                  textValue={t`MCP servers`}
                  className="!cursor-default !bg-transparent !opacity-100"
                >
                  <Header className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                    <Trans>MCP servers</Trans>
                  </Header>
                </ListBox.Item>
              ) : null}
              {visibleMcpServers.map((server) => {
                const Icon = server.descriptor.icon;
                const label = t(server.descriptor.label);
                return (
                  <ListBox.Item
                    key={server.descriptor.id}
                    id={server.descriptor.id}
                    textValue={label}
                    className="focus-visible:outline-none"
                  >
                    <Icon className="size-4 text-muted" />
                    <Label className="flex-1 truncate">{label}</Label>
                    <span className="ms-auto truncate text-xs text-muted">
                      {server.enabled ? t`Disable` : t`Enable`}
                    </span>
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Popover.Dialog>
        </Popover.Content>
      ) : null}
    </Popover>
  );
}
