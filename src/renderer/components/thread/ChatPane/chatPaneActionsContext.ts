import { createContext, useContext } from "react";

export type ChatPaneActions = {
  openProjectRelativePath: (path: string, lineNumber?: number) => void;
  /** Open the in-app file editor overlay and expand the project tree to the folder. */
  revealProjectFolderInTree: (path: string) => void;
  /** Reveal a file or folder in the OS file explorer (Finder/Explorer/Nautilus). */
  showProjectEntryInExplorer: (path: string) => void;
  onContentHeightChange: () => void;
};

export const ChatPaneActionsContext = createContext<ChatPaneActions | null>(null);

export function useChatPaneActions(): ChatPaneActions | null {
  return useContext(ChatPaneActionsContext);
}
