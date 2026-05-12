import type { PromptSegment } from "@/shared/contracts";
import type { PaneLayout } from "@/shared/paneLayout";
import type { Attachment } from "@/renderer/components/composer/useAttachments";

export interface DraftContent {
  segments: PromptSegment[];
  attachments: Attachment[];
}

export interface SavedGroupLayout {
  panes: string[];
  paneLayout?: PaneLayout;
}
