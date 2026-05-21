import { Globe, X } from "lucide-react";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { toLocalFileUrl } from "@/shared/promptContent";
import type { Attachment } from "./useAttachments";

export function BrowserChip(props: { onRemove?: (() => void) | undefined }) {
  const { onRemove } = props;
  return (
    <div
      className="lightcode-attachment-chip lightcode-browser-chip"
      title="Browser MCP enabled for this thread"
    >
      <Globe className="size-3 text-muted" />
      <span className="lightcode-attachment-chip__name">Browser</span>
      {onRemove ? (
        <button
          type="button"
          className="lightcode-attachment-chip__delete"
          aria-label="Disable Browser MCP"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="size-2" />
        </button>
      ) : null}
    </div>
  );
}

function AttachmentChip(props: {
  attachment: Attachment;
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: ((attachment: Attachment) => void) | undefined;
  hideImageName?: boolean;
}) {
  const { attachment: att, onRemove, onPreviewImage, hideImageName } = props;
  const isPicked = !!att.selector;
  const labelText = isPicked ? att.selector! : att.name;
  const showLabel = isPicked || !att.isImage || !hideImageName;
  const tooltip = isPicked
    ? att.sourceUrl
      ? `${att.selector}\n${att.sourceUrl}`
      : att.selector
    : undefined;
  const labelClass = isPicked
    ? "lightcode-attachment-chip__name lightcode-attachment-chip__selector"
    : "lightcode-attachment-chip__name";

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
      {showLabel ? (
        <span className={labelClass} {...(tooltip ? { title: tooltip } : {})}>
          {labelText}
        </span>
      ) : null}
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
      <div
        className="lightcode-attachment-chip"
        role="button"
        tabIndex={0}
        onClick={() => onPreviewImage(att)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPreviewImage(att);
          }
        }}
      >
        {content}
      </div>
    );
  }

  return <div className="lightcode-attachment-chip">{content}</div>;
}

function ImagePreview(props: {
  attachment: Attachment;
  onPreviewImage?: ((attachment: Attachment) => void) | undefined;
}) {
  const { attachment: att, onPreviewImage } = props;
  const img = <img src={toLocalFileUrl(att.path)} alt={att.name} draggable={false} />;
  if (onPreviewImage) {
    return (
      <button
        type="button"
        className="lightcode-attachment-image-preview"
        onClick={() => onPreviewImage(att)}
        aria-label={`Preview ${att.name}`}
      >
        {img}
      </button>
    );
  }
  return <span className="lightcode-attachment-image-preview">{img}</span>;
}

export function AttachmentBar(props: {
  attachments: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
  onPreviewImage?: (attachment: Attachment) => void;
  layout?: "inset" | "flush";
  hideImageNames?: boolean;
  imagesAsPreview?: boolean;
}) {
  const {
    attachments,
    onRemove,
    onPreviewImage,
    layout = "inset",
    hideImageNames,
    imagesAsPreview,
  } = props;
  if (attachments.length === 0) return null;

  const className =
    layout === "inset"
      ? "lightcode-attachment-bar lightcode-attachment-bar--inset"
      : "lightcode-attachment-bar";

  return (
    <div className={className}>
      {attachments.map((att) =>
        imagesAsPreview && att.isImage && !att.selector ? (
          <ImagePreview key={att.id} attachment={att} onPreviewImage={onPreviewImage} />
        ) : (
          <AttachmentChip
            key={att.id}
            attachment={att}
            onRemove={onRemove}
            onPreviewImage={onPreviewImage}
            {...(hideImageNames === undefined ? {} : { hideImageName: hideImageNames })}
          />
        ),
      )}
    </div>
  );
}
