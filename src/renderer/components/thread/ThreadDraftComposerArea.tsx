import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@heroui/react";
import type {
  AgentStatus,
  Project,
  PromptSegment,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import {
  AttachmentBar,
  ImageLightbox,
  MentionInput,
  type MentionInputHandle,
  useAttachments,
} from "@/renderer/components/composer";
import { flattenSegments } from "@/renderer/components/composer/serializeMentions";
import {
  BranchSelector,
  generateWorktreeBranch,
  type BranchSelection,
} from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import { ThreadComposer, type ComposerControl } from "./ThreadComposer";

export type DraftStartInput = {
  agentKind: AgentStatus["kind"];
  config: ThreadConfig;
  prompt: string;
  segments?: PromptSegment[];
  existingWorktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeIsNewBranch?: boolean;
  presentationMode?: ThreadPresentationMode;
};

export function ThreadDraftComposerArea(props: {
  project: Project;
  selectedAgent: AgentStatus;
  controls: ComposerControl[];
  config: ThreadConfig;
  compact: boolean | undefined;
  paneCount: number | undefined;
  gitBranch: string | undefined;
  worktreeMode: boolean;
  supportsModePicker: boolean;
  presentationMode: ThreadPresentationMode;
  onWorktreeModeChange: (worktreeMode: boolean) => void;
  onSwitchBranch: (branch: string, createNew: boolean) => void;
  onRememberPresentationMode: () => void;
  onStart: (input: DraftStartInput) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  const attachments = useAttachments();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [branchSelection, setBranchSelection] = useState<BranchSelection | null>(null);
  const imageAttachments = attachments.attachments.filter((a) => a.isImage);
  const saveDraftContent = useAppStore((s) => s.saveDraftContent);
  const clearDraftContent = useAppStore((s) => s.clearDraftContent);
  const latestSegmentsRef = useRef<PromptSegment[]>([]);
  const attachmentsRef = useRef(attachments.attachments);
  attachmentsRef.current = attachments.attachments;
  const initialDraftRef = useRef(useAppStore.getState().draftContents[props.project.id]);

  function resetDraftRefs() {
    latestSegmentsRef.current = [];
    attachmentsRef.current = [];
  }

  function submitSegments(allSegments: PromptSegment[], fallbackPrompt = "") {
    const flatPrompt = flattenSegments(allSegments) || fallbackPrompt.trim();
    if (flatPrompt.length === 0) return;

    resetDraftRefs();
    const useWorktree = branchSelection?.isWorktree ?? props.worktreeMode;
    if (props.supportsModePicker) {
      props.onRememberPresentationMode();
    }
    props.onStart({
      agentKind: props.selectedAgent.kind,
      config: props.config,
      prompt: flatPrompt,
      ...(allSegments.length > 0 ? { segments: allSegments } : {}),
      ...(props.supportsModePicker ? { presentationMode: props.presentationMode } : {}),
      ...(useWorktree
        ? branchSelection?.worktreePath
          ? {
              existingWorktreePath: branchSelection.worktreePath,
              worktreeBranch: branchSelection.branch,
            }
          : {
              worktreeBranch: generateWorktreeBranch(),
              ...(branchSelection?.baseBranch
                ? { worktreeBaseBranch: branchSelection.baseBranch }
                : {}),
              worktreeIsNewBranch: true,
            }
        : {}),
    });
    attachments.clearAll();
  }

  useLayoutEffect(() => {
    const saved = initialDraftRef.current;
    if (!saved) return;
    if (saved.segments.length > 0) {
      mentionRef.current?.restoreFromSegments(saved.segments);
      latestSegmentsRef.current = saved.segments;
    }
    if (saved.attachments.length > 0) {
      attachments.restore(saved.attachments);
    }
    clearDraftContent(props.project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time mount restore
  }, []);

  useEffect(() => {
    const pid = props.project.id;
    return () => {
      const segments = latestSegmentsRef.current;
      const atts = attachmentsRef.current;
      if (segments.length > 0 || atts.length > 0) {
        saveDraftContent(pid, { segments, attachments: atts });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only effect keyed on project
  }, [props.project.id, saveDraftContent]);

  return (
    <>
      <ThreadComposer
        autoFocus={(props.paneCount ?? 1) === 1} // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
        compact={props.compact ?? false}
        controls={props.controls}
        attachmentBar={
          <AttachmentBar
            attachments={attachments.attachments}
            onRemove={attachments.removeAttachment}
            onPreviewImage={(att) => {
              const idx = imageAttachments.findIndex((a) => a.id === att.id);
              if (idx >= 0) setLightboxIndex(idx);
            }}
          />
        }
        inputContent={
          <MentionInput
            ref={mentionRef}
            autoFocus={(props.paneCount ?? 1) === 1} // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
            compact={props.compact ?? false}
            placeholder="Send a message..."
            projectLocation={props.project.location}
            projectId={props.project.id}
            onTextChange={(hasText) => {
              setHasContent(hasText);
              latestSegmentsRef.current = mentionRef.current?.serializeSegments() ?? [];
            }}
            onPasteImage={(file) => {
              void attachments.addClipboardImage(file, `draft:${props.project.id}`);
            }}
            onSubmit={(segments) => {
              submitSegments([...attachments.toSegments(), ...segments]);
            }}
          />
        }
        placeholder="Send a message..."
        prompt={prompt}
        submitDisabled={!(hasContent || attachments.attachments.length > 0)}
        submitLabel="Launch thread"
        onPromptChange={setPrompt}
        onSubmit={() => {
          const segments = mentionRef.current?.serializeSegments() ?? [];
          submitSegments([...attachments.toSegments(), ...segments], prompt);
        }}
        afterControls={
          <>
            <Button
              isIconOnly
              aria-label="Attach files"
              className="lightcode-composer-menu min-w-9 px-2"
              size="sm"
              variant="ghost"
              onPress={() => {
                void readBridge()
                  .pickFiles()
                  .then((paths) => {
                    if (paths) attachments.addFiles(paths);
                  });
              }}
            >
              <Paperclip className="size-4" />
            </Button>
            {props.gitBranch ? (
              <BranchSelector
                projectId={props.project.id}
                currentBranch={props.gitBranch}
                value={branchSelection?.branch ?? props.gitBranch}
                isWorktree={branchSelection?.isWorktree}
                baseBranch={branchSelection?.baseBranch}
                worktreeMode={props.worktreeMode}
                onWorktreeModeChange={props.onWorktreeModeChange}
                onSelect={setBranchSelection}
                onSwitchBranch={props.onSwitchBranch}
              />
            ) : null}
          </>
        }
      />
      {lightboxIndex !== null && imageAttachments.length > 0 ? (
        <ImageLightbox
          images={imageAttachments}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </>
  );
}
