import { createContext, useContext } from "react";

export type ChatPaneActions = {
  openProjectRelativePath: (path: string) => void;
  onContentHeightChange: () => void;
};

export const ChatPaneActionsContext = createContext<ChatPaneActions | null>(null);

export function useChatPaneActions(): ChatPaneActions | null {
  return useContext(ChatPaneActionsContext);
}
