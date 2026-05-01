import type { PrFile } from "@/shared/contracts";
import { getBasename } from "@/shared/pathUtils";
import { FileIcon } from "@/renderer/components/common";

export function PrFileRow(props: { file: PrFile; isSelected: boolean; onSelect: () => void }) {
  const { file, isSelected, onSelect } = props;
  const basename = getBasename(file.path);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : undefined;

  return (
    <button
      type="button"
      className={`flex w-full cursor-default items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors ${
        isSelected
          ? "bg-white/[0.08] text-foreground"
          : "text-muted hover:bg-white/[0.04] hover:text-foreground"
      }`}
      onClick={onSelect}
    >
      <FileIcon path={file.path} />
      <span className="min-w-0 flex-1 truncate" title={file.path}>
        <span className="text-foreground">{basename}</span>
        {dir && <span className="ml-1 text-muted/60">{dir}</span>}
      </span>
      <span className="flex w-14 shrink-0 items-center justify-end text-[10px] leading-4 font-medium">
        {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
        {file.deletions > 0 && <span className="ml-0.5 text-danger">-{file.deletions}</span>}
      </span>
    </button>
  );
}
