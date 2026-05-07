import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { getBasename } from "@/shared/pathUtils";

interface InlineFilePathChipProps {
  path: string;
  line?: number | undefined;
  onOpen?: ((path: string, lineNumber?: number) => void) | undefined;
}

/**
 * Inline chip rendered inside chat markdown for `path[:line]` references.
 * Vertically centered with surrounding prose (em-based sizing) so it reads
 * inline without clipping descenders. Mirrors the visual language of
 * `.lightcode-mention-chip` used in the composer.
 */
export function InlineFilePathChip({ path, line, onOpen }: InlineFilePathChipProps) {
  const basename = getBasename(path);
  const iconUrl = getEntryIconUrl(basename, false);
  const title = line !== undefined ? `${path}:${line}` : path;
  return (
    <button
      type="button"
      className="lightcode-inline-path-chip"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(path, line);
      }}
    >
      <img className="lightcode-inline-path-chip__icon" src={iconUrl} alt="" draggable={false} />
      <span className="lightcode-inline-path-chip__name">{basename}</span>
      {line !== undefined ? (
        <span className="lightcode-inline-path-chip__line">{`· L${line}`}</span>
      ) : null}
    </button>
  );
}
