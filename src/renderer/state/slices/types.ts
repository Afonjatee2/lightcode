import type { PromptSegment, ThreadServerRequestId } from "@/shared/contracts";
import type { PaneLayout } from "@/shared/paneLayout";
import type { Attachment } from "@/renderer/components/composer/useAttachments";

export interface PendingThreadServerRequest {
  threadId: string;
  requestId: ThreadServerRequestId;
  method: string;
  params: unknown;
  receivedAt: string;
}

export interface DraftContent {
  segments: PromptSegment[];
  attachments: Attachment[];
}

export interface SavedGroupLayout {
  panes: string[];
  paneLayout?: PaneLayout;
}
