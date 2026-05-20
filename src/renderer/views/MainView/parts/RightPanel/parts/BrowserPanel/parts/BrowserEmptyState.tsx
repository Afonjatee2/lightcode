import { Globe } from "lucide-react";

export function BrowserEmptyState(props: { onCreateTab: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-foreground/60">
      <Globe className="size-8 text-sky-400/60" />
      <div className="text-sm">No browser tab open</div>
      <button
        type="button"
        className="rounded bg-sky-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-400"
        onClick={props.onCreateTab}
      >
        Open new tab
      </button>
    </div>
  );
}
