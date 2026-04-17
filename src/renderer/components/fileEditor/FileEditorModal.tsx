import { Button, Modal, toast } from "@heroui/react";
import { Maximize2, X } from "lucide-react";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { FileEditorPane } from "./FileEditorPane";
import { ProjectTreeView } from "./ProjectTreeView";

export function FileEditorModal() {
  const rootContext = useFileEditorStore((state) => state.rootContext);
  const overlayMode = useFileEditorStore((state) => state.overlayMode);
  const activePath = useFileEditorStore((state) => state.activePath);
  const openTabs = useFileEditorStore((state) => state.tabs);
  const buffers = useFileEditorStore((state) => state.buffers);
  const setOverlayMode = useFileEditorStore((state) => state.setOverlayMode);
  const openFile = useFileEditorStore((state) => state.openFile);
  const pinTab = useFileEditorStore((state) => state.pinTab);

  const isOpen = rootContext !== null && overlayMode === "modal";
  const hasDirtyBuffers = Object.values(buffers).some(
    (buffer) => buffer.status === "ready" && buffer.isDirty,
  );

  function requestClose() {
    if (hasDirtyBuffers && !window.confirm("Discard unsaved editor changes?")) {
      return;
    }
    setOverlayMode(null);
  }

  if (!rootContext) return null;

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        isDismissable
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose();
        }}
      >
        <Modal.Container
          placement="center"
          scroll="inside"
          size="cover"
          className="items-center px-6 py-6"
        >
          <Modal.Dialog className="h-[min(82vh,860px)] w-[min(1180px,94vw)] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--content-background)]">
            <Modal.Header className="border-b border-[color:var(--border)]">
              <div className="min-w-0 flex-1">
                <Modal.Heading>{rootContext.rootLabel}</Modal.Heading>
                <p className="truncate text-xs text-muted">
                  {activePath ?? "Select a file from the tree"}
                </p>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => setOverlayMode("fullscreen")}
              >
                <Maximize2 className="size-4" />
              </Button>
              <Button isIconOnly size="sm" variant="ghost" onPress={requestClose}>
                <X className="size-4" />
              </Button>
            </Modal.Header>
            <Modal.Body className="min-h-0 p-0">
              <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
                <div className="min-h-0 border-r border-[color:var(--border)]">
                  <ProjectTreeView
                    rootContext={rootContext}
                    selectedPath={activePath}
                    openTabs={openTabs}
                    onSelectFile={(path) => {
                      void openFile(path, "modal", true).catch((error) =>
                        toast.danger(error instanceof Error ? error.message : String(error)),
                      );
                    }}
                    onPinFile={pinTab}
                  />
                </div>
                <FileEditorPane
                  showTabs={false}
                  onOpenFullscreen={() => setOverlayMode("fullscreen")}
                />
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
