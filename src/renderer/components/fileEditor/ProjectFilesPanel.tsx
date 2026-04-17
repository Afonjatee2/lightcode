import { toast } from "@heroui/react";
import {
  useFileEditorStore,
  type FileEditorOverlayMode,
  type FileEditorRootContext,
} from "@/renderer/state/fileEditorStore";
import { ProjectTreeView } from "./ProjectTreeView";

export function ProjectFilesPanel(props: { rootContext: FileEditorRootContext }) {
  const selectedPath = useFileEditorStore((state) => state.activePath);
  const openTabs = useFileEditorStore((state) => state.tabs);
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
      selectedPath={selectedPath}
      openTabs={openTabs}
      onSelectFile={handleSelectFile}
      onPinFile={pinTab}
    />
  );
}
