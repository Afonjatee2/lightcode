import { toast } from "@heroui/react";
import {
  useFileEditorStore,
  type FileEditorOverlayMode,
  type FileEditorRootContext,
} from "@/renderer/state/fileEditorStore";
import { ProjectTreeView } from "@/renderer/views/FileEditorOverlay/parts/ProjectTreeView/ProjectTreeView";

export function ProjectFilesPanel(props: { rootContext: FileEditorRootContext }) {
  const overlayMode = useFileEditorStore((state) => state.overlayMode);
  const openFile = useFileEditorStore((state) => state.openFile);
  const pinTab = useFileEditorStore((state) => state.pinTab);

  function handleSelectFile(path: string) {
    const nextMode: FileEditorOverlayMode = overlayMode === "fullscreen" ? "fullscreen" : "modal";
    void openFile(path, nextMode, true).catch((error) =>
      toast.danger(error instanceof Error ? error.message : String(error)),
    );
  }

  return (
    <ProjectTreeView
      rootContext={props.rootContext}
      onSelectFile={handleSelectFile}
      onPinFile={pinTab}
    />
  );
}
