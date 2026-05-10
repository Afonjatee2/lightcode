import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FileEntry, ProjectLocation, PromptSegment } from "@/shared/contracts";
import { fileNameFromPath } from "@/shared/promptContent";
import { createChipElement, type FileMentionData } from "./FileMentionChip";
import { MentionPopover } from "./MentionPopover";
import { useDebouncedFileSearch } from "./useDebouncedFileSearch";
import { serializeToSegments, flattenSegments } from "./serializeMentions";

export interface MentionInputHandle {
  /** Get structured segments (text + file mentions) for the adapter pipeline. */
  serializeSegments(): PromptSegment[];
  /** Flatten to a display string (convenience). */
  serialize(): string;
  /** Rebuild the editor content from previously serialized segments. */
  restoreFromSegments(segments: PromptSegment[]): void;
  focus(): void;
  clear(): void;
  insertSlashCommand(id: string): void;
}

interface MentionState {
  query: string;
}

interface TriggerContext {
  textNode: Text;
  triggerIndex: number;
  cursorOffset: number;
}

/**
 * Scan backward from the current cursor position to find an active trigger
 * character (`@` or `/`) at start-of-line or after whitespace, with no
 * intervening whitespace between the trigger and the cursor.
 */
function detectTriggerContext(triggerChar: string): TriggerContext | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return null;

  const textNode = sel.anchorNode;
  if (textNode.nodeType !== Node.TEXT_NODE) return null;

  const text = textNode.textContent ?? "";
  const offset = sel.anchorOffset;

  let triggerIndex = -1;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === triggerChar) {
      if (i === 0 || /\s/.test(text[i - 1]!)) {
        triggerIndex = i;
      }
      break;
    }
    if (/\s/.test(ch)) break;
  }

  if (triggerIndex < 0) return null;
  return { textNode: textNode as Text, triggerIndex, cursorOffset: offset };
}

function detectTriggerQuery(triggerChar: string): string | null {
  const ctx = detectTriggerContext(triggerChar);
  if (!ctx) return null;
  return (ctx.textNode.textContent ?? "").slice(ctx.triggerIndex + 1, ctx.cursorOffset);
}

function detectTriggerRange(triggerChar: string): Range | null {
  const ctx = detectTriggerContext(triggerChar);
  if (!ctx) return null;
  const range = document.createRange();
  range.setStart(ctx.textNode, ctx.triggerIndex);
  range.setEnd(ctx.textNode, ctx.cursorOffset);
  return range;
}

function hasEditorContent(editor: HTMLDivElement): boolean {
  if (editor.querySelector("[data-mention-path]")) return true;
  return (editor.textContent ?? "").trim().length > 0;
}

export const MentionInput = forwardRef<
  MentionInputHandle,
  {
    autoFocus?: boolean;
    compact?: boolean;
    disabled?: boolean;
    placeholder: string;
    projectLocation: ProjectLocation | undefined;
    projectId?: string;
    onTextChange: (hasText: boolean) => void;
    onSubmit: (segments: PromptSegment[]) => void;
    onPasteImage?: (file: File) => void;
    onSlashCommandChange?: (query: string | null) => void;
    /**
     * Called before MentionInput's own key handling (after the mention popover
     * absorbs navigation keys). Return `true` to indicate the key was handled
     * and stop further processing.
     */
    onInterceptKey?: (e: React.KeyboardEvent<HTMLDivElement>) => boolean;
  }
>(function MentionInput(props, ref) {
  const {
    autoFocus,
    compact,
    disabled,
    placeholder,
    projectLocation,
    projectId,
    onTextChange,
    onSubmit,
    onPasteImage,
    onSlashCommandChange,
    onInterceptKey,
  } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSlashQueryRef = useRef<string | null>(null);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useDebouncedFileSearch(
    projectLocation,
    mention?.query ?? "",
    mention !== null,
    projectId,
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useImperativeHandle(ref, () => ({
    serializeSegments() {
      if (!editorRef.current) return [];
      return serializeToSegments(editorRef.current);
    },
    serialize() {
      if (!editorRef.current) return "";
      return flattenSegments(serializeToSegments(editorRef.current));
    },
    restoreFromSegments(segments: PromptSegment[]) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = "";
      for (const seg of segments) {
        if (seg.kind === "text") {
          const lines = seg.content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) editor.appendChild(document.createElement("br"));
            const line = lines[i]!;
            if (line) editor.appendChild(document.createTextNode(line));
          }
        } else if (seg.kind === "file") {
          const chip = createChipElement({
            path: seg.path,
            name: fileNameFromPath(seg.path),
            isDirectory: false,
          });
          editor.appendChild(chip);
        }
      }
      onTextChange(hasEditorContent(editor));
    },
    focus() {
      editorRef.current?.focus();
    },
    clear() {
      if (editorRef.current) {
        editorRef.current.innerHTML = "";
        setMention(null);
        if (lastSlashQueryRef.current !== null) {
          lastSlashQueryRef.current = null;
          onSlashCommandChange?.(null);
        }
      }
    },
    insertSlashCommand(id: string) {
      if (!editorRef.current) return;

      const range = detectTriggerRange("/");
      if (!range) return;

      const sel = window.getSelection();
      if (!sel) return;

      sel.removeAllRanges();
      sel.addRange(range);
      range.deleteContents();

      const textNode = document.createTextNode(`/${id} `);
      range.insertNode(textNode);

      const newRange = document.createRange();
      newRange.setStartAfter(textNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      if (lastSlashQueryRef.current !== null) {
        lastSlashQueryRef.current = null;
        onSlashCommandChange?.(null);
      }
      notifyTextChange();
    },
  }));

  useEffect(() => {
    if (autoFocus) {
      editorRef.current?.focus();
    }
  }, [autoFocus]);

  function checkMentionState() {
    const query = detectTriggerQuery("@");
    setMention(query !== null ? { query } : null);
    const nextSlash = query === null ? detectTriggerQuery("/") : null;
    if (lastSlashQueryRef.current !== nextSlash) {
      lastSlashQueryRef.current = nextSlash;
      onSlashCommandChange?.(nextSlash);
    }
  }

  function notifyTextChange() {
    if (!editorRef.current) return;
    onTextChange(hasEditorContent(editorRef.current));
  }

  function insertMention(entry: FileEntry) {
    if (!editorRef.current) return;

    const range = detectTriggerRange("@");
    if (!range) return;

    const mentionData: FileMentionData = {
      path: entry.path,
      name: entry.name,
      isDirectory: entry.type === "directory",
    };

    const chip = createChipElement(mentionData);

    const sel = window.getSelection();
    if (!sel) return;

    sel.removeAllRanges();
    sel.addRange(range);
    range.deleteContents();
    range.insertNode(chip);

    // Insert a space text node after the chip for cursor placement
    const space = document.createTextNode("\u00A0");
    chip.after(space);

    // Move cursor after the space
    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMention(null);
    notifyTextChange();
  }

  function handleInput() {
    checkMentionState();
    notifyTextChange();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // When popover is open, capture navigation keys
    if (mention && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const selected = results[activeIndex];
        if (selected) insertMention(selected);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (onInterceptKey?.(e)) return;

    // Enter without popover = submit
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!editorRef.current) return;
      const segments = serializeToSegments(editorRef.current);
      if (flattenSegments(segments).length > 0) {
        onSubmit(segments);
      }
      return;
    }

    // Backspace: check if we should delete an adjacent chip
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.anchorNode) {
        const node = sel.anchorNode;
        const offset = sel.anchorOffset;

        if (node.nodeType === Node.TEXT_NODE && offset === 0) {
          const prev = node.previousSibling as HTMLElement | null;
          if (prev?.dataset?.mentionPath) {
            e.preventDefault();
            prev.remove();
            notifyTextChange();
            return;
          }
        }

        if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
          const child = node.childNodes[offset - 1] as HTMLElement | undefined;
          if (child?.dataset?.mentionPath) {
            e.preventDefault();
            child.remove();
            notifyTextChange();
            return;
          }
        }
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const imageFile =
      Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/")) ??
      (() => {
        for (const item of e.clipboardData.items) {
          if (item.type.startsWith("image/")) {
            return item.getAsFile();
          }
        }
        return null;
      })();

    if (imageFile && onPasteImage) {
      e.preventDefault();
      onPasteImage(imageFile);
      return;
    }

    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    notifyTextChange();
  }

  const editorClassName = compact
    ? "lightcode-mention-input lightcode-mention-input--compact"
    : "lightcode-mention-input";

  const liveRange = mention ? detectTriggerRange("@") : null;

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-disabled={disabled || undefined}
        aria-multiline="true"
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        className={editorClassName}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={checkMentionState}
        {...({ placeholder } as React.HTMLAttributes<HTMLDivElement>)}
      />
      {mention && liveRange && results.length > 0 && (
        <MentionPopover
          results={results}
          activeIndex={activeIndex}
          editorEl={editorRef.current}
          mentionRange={liveRange}
          onSelect={insertMention}
          onActiveIndexChange={setActiveIndex}
        />
      )}
    </div>
  );
});
