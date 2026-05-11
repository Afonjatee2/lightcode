import { X } from "lucide-react";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { toLocalFileUrl } from "@/shared/promptContent";
import type { Attachment } from "./useAttachments";

function AttachmentChip(props: {
  attachment: Attachment;
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: ((attachment: Attachment) => void) | undefined;
  hideImageName?: boolean;
}) {
  const { attachment: att, onRemove, onPreviewImage, hideImageName } = props;
  const showName = !att.isImage || !hideImageName;

  const content = (
    <>
      {att.isImage ? (
        <img
          className="lightcode-attachment-chip__thumb"
          src={toLocalFileUrl(att.path)}
          alt={att.name}
          draggable={false}
        />
      ) : (
        <img
          className="lightcode-attachment-chip__icon"
          src={getEntryIconUrl(att.name, false)}
          alt=""
          draggable={false}
        />
      )}
      {showName ? <span className="lightcode-attachment-chip__name">{att.name}</span> : null}
      {onRemove ? (
        <button
          type="button"
          className="lightcode-attachment-chip__delete"
          aria-label={`Remove ${att.name}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(att.id);
          }}
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </>
  );

  if (att.isImage && onPreviewImage) {
    return (
      <button
        type="button"
        className="lightcode-attachment-chip"
        onClick={() => onPreviewImage(att)}
      >
        {content}
      </button>
    );
  }

  return <div className="lightcode-attachment-chip">{content}</div>;
}

export function AttachmentBar(props: {
  attachments: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: (attachment: Attachment) => void;
  layout?: "inset" | "flush";
  hideImageNames?: boolean;
}) {
  const { attachments, onRemove, onPreviewImage, layout = "inset", hideImageNames } = props;
  if (attachments.length === 0) return null;

  const className =
    layout === "inset"
      ? "lightcode-attachment-bar lightcode-attachment-bar--inset"
      : "lightcode-attachment-bar";

  return (
    <div className={className}>
      {attachments.map((att) => (
        <AttachmentChip
          key={att.id}
          attachment={att}
          onRemove={onRemove}
          onPreviewImage={onPreviewImage}
          {...(hideImageNames === undefined ? {} : { hideImageName: hideImageNames })}
        />
      ))}
    </div>
  );
}
