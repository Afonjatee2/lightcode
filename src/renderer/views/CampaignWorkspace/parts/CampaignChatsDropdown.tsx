import { Dropdown, Header, Label } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown, MessageSquarePlus } from "lucide-react";
import type { Thread } from "@/shared/contracts";

function formatChatRecency(thread: Thread): string {
  const at = Math.max(new Date(thread.updatedAt).getTime(), new Date(thread.createdAt).getTime());
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CampaignChatsDropdown(props: {
  chats: readonly Thread[];
  activeChatId: string | undefined;
  isCreating: boolean;
  onSelectChat: (threadId: string) => void;
  onNewChat: () => void;
}) {
  const { t } = useLingui();
  const activeChat = props.activeChatId
    ? props.chats.find((chat) => chat.id === props.activeChatId)
    : undefined;
  const triggerLabel = activeChat?.title ?? t`Chats`;

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={t`Campaign chats`}
        className="cockpit-topic-tab shrink-0 gap-1.5 px-2.5"
        data-testid="campaign-chats-trigger"
      >
        <span className="max-w-[9rem] truncate">{triggerLabel}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom start">
        <Dropdown.Menu
          aria-label={t`Campaign chats`}
          selectionMode="single"
          selectedKeys={props.activeChatId ? [props.activeChatId] : []}
          onAction={(key) => {
            if (key === "new-chat") {
              props.onNewChat();
              return;
            }
            props.onSelectChat(String(key));
          }}
        >
          <Dropdown.Section>
            <Header>
              <Trans>Chats</Trans>
            </Header>
            <Dropdown.Item id="new-chat" textValue={t`New chat`}>
              <MessageSquarePlus className="size-3.5 shrink-0 text-muted" aria-hidden />
              <Label>{props.isCreating ? <Trans>Creating…</Trans> : <Trans>New chat</Trans>}</Label>
            </Dropdown.Item>
            {props.chats.length === 0 ? (
              <Dropdown.Item id="no-chats" isDisabled textValue={t`No chats yet`}>
                <Label className="text-muted">
                  <Trans>No chats yet</Trans>
                </Label>
              </Dropdown.Item>
            ) : (
              props.chats.map((chat) => (
                <Dropdown.Item key={chat.id} id={chat.id} textValue={chat.title}>
                  <Dropdown.ItemIndicator />
                  <Label className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{chat.title}</span>
                    <span className="text-[10px] font-normal text-muted">
                      {formatChatRecency(chat)}
                    </span>
                  </Label>
                </Dropdown.Item>
              ))
            )}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
