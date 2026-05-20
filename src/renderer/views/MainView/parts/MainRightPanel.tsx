import { DevTerminalPanel } from "@/renderer/views/MainView/parts/RightPanel/parts/DevTerminalPanel/DevTerminalPanel";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProjectAuxiliaryPanel } from "./ProjectAuxiliaryPanel";

export function MainRightPanel() {
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);

  const isTerminalRight = terminalPosition === "right";

  if (!isTerminalRight) {
    return <DevTerminalPanel />;
  }

  return <ProjectAuxiliaryPanel includeTerminal />;
}
