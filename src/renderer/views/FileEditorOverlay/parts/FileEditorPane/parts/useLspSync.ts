import { useEffect, type MutableRefObject } from "react";
import type { Monaco } from "@monaco-editor/react";
import { useFileEditorStore } from "@/renderer/state/fileEditorStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { lspOrchestrator } from "@/renderer/lsp";

export function useLspSync(params: {
  monacoRef: MutableRefObject<Monaco | null>;
  activePath: string | null;
  bufferStatus: string | null;
}) {
  const { monacoRef, activePath, bufferStatus } = params;
  const lspEnabled = useSharedSettings((s) => s.editorLspEnabled);
  const rootProjectId = useFileEditorStore((state) => state.rootContext?.projectId ?? null);
  const rootProjectLocation = useFileEditorStore(
    (state) => state.rootContext?.projectLocation ?? null,
  );

  // Start language server when a file opens (if enabled)
  useEffect(() => {
    if (!lspEnabled || !monacoRef.current || !rootProjectId || !rootProjectLocation || !activePath)
      return;
    void lspOrchestrator.ensureServer(
      monacoRef.current,
      rootProjectId,
      rootProjectLocation,
      activePath,
    );
  }, [lspEnabled, rootProjectId, rootProjectLocation, activePath, monacoRef]);

  // Document sync — didOpen when buffer loads
  useEffect(() => {
    if (!lspEnabled || !rootProjectId || !activePath || bufferStatus !== "ready") return;
    const session = lspOrchestrator.getSession(rootProjectId, activePath);
    if (!session) return;

    const currentBuffer = useFileEditorStore.getState().buffers[activePath];
    if (!currentBuffer || currentBuffer.status !== "ready") return;

    const uri = `file:///${activePath}`;
    session.docSync.didOpen(uri, currentBuffer.content, activePath);

    // Watch model for changes
    const model = monacoRef.current?.editor.getModel(monacoRef.current.Uri.file(`/${activePath}`));
    if (model) session.docSync.watchModel(model);
  }, [lspEnabled, rootProjectId, activePath, bufferStatus, monacoRef]);

  // Cleanup when project changes
  useEffect(() => {
    const projectId = rootProjectId;
    return () => {
      if (projectId) void lspOrchestrator.stopProject(projectId);
    };
  }, [rootProjectId]);

  function notifyDidSave(path: string) {
    if (!lspEnabled || !rootProjectId) return;
    const session = lspOrchestrator.getSession(rootProjectId, path);
    const savedBuffer = useFileEditorStore.getState().buffers[path];
    if (session && savedBuffer?.status === "ready") {
      session.docSync.didSave(`file:///${path}`, savedBuffer.content);
    }
  }

  return { notifyDidSave };
}
