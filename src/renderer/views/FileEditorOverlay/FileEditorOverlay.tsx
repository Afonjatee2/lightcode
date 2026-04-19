import { toast } from "@heroui/react";
import { ArrowLeft } from "lucide-react";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { ProjectTreeView } from "@/renderer/views/FileEditorOverlay/parts/ProjectTreeView/ProjectTreeView";
import { FileEditorPane } from "./parts/FileEditorPane/FileEditorPane";
import { SidebarButton } from "@/renderer/components/common";

export function FileEditorOverlay(props: { onClose: () => void }) {
  const rootContext = useFileEditorStore((state) => state.rootContext);
  const buffers = useFileEditorStore((state) => state.buffers);
  const openFile = useFileEditorStore((state) => state.openFile);
  const pinTab = useFileEditorStore((state) => state.pinTab);

  if (!rootContext) return null;

  const hasDirtyBuffers = Object.values(buffers).some(
    (buffer) => buffer.status === "ready" && buffer.isDirty,
  );

  function requestClose() {
    if (hasDirtyBuffers && !window.confirm("Discard unsaved editor changes?")) {
      return;
    }
    props.onClose();
  }

  return (
    <PageLayout
      title="Editor"
      sidebarHeaderChildren={
        <span className="min-w-0 truncate font-mono text-[13px] font-medium tracking-tight text-muted">
          {rootContext.rootLabel}
        </span>
      }
      sidebar={
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectTreeView
              rootContext={rootContext}
              onSelectFile={(path) => {
                void openFile(path, "fullscreen", true).catch((error) =>
                  toast.danger(error instanceof Error ? error.message : String(error)),
                );
              }}
              onPinFile={pinTab}
            />
          </div>
          <div className="space-y-1 border-t border-white/6 px-2 pt-2 pb-1">
            <SidebarButton
              icon={<ArrowLeft className="size-4" />}
              label="Return to app"
              onPress={requestClose}
            />
          </div>
        </div>
      }
      content={<FileEditorPane showTabs />}
    />
  );
}
