import { MessageSquare, TerminalSquare } from "lucide-react";
import { Tabs } from "@heroui/react";
import type { ThreadPresentationMode } from "@/shared/contracts";

export interface PresentationModeTabsProps {
  presentationMode: ThreadPresentationMode;
  onChange: (next: ThreadPresentationMode) => void;
  /** When false, the CLI tab renders disabled. */
  supportsTerminal: boolean;
  /** When false, the Chat tab renders disabled. */
  supportsGui: boolean;
  className?: string;
}

/**
 * CLI/Chat presentation-mode picker. Always renders both tabs; unsupported
 * surfaces are disabled rather than hidden so the user sees the full set of
 * possibilities for the current provider.
 */
export function PresentationModeTabs(props: PresentationModeTabsProps) {
  const { presentationMode, onChange, supportsTerminal, supportsGui, className } = props;
  return (
    <div className={className}>
      <Tabs
        className="w-fit"
        selectedKey={presentationMode}
        onSelectionChange={(key) => {
          if (key === "terminal" || key === "gui") onChange(key);
        }}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Thread mode" className="w-fit">
            <Tabs.Tab id="terminal" isDisabled={!supportsTerminal}>
              <span className="inline-flex items-center gap-1.5">
                <TerminalSquare className="size-3.5" />
                CLI
              </span>
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="gui" isDisabled={!supportsGui}>
              <Tabs.Separator />
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="size-3.5" />
                Chat
              </span>
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </div>
  );
}
