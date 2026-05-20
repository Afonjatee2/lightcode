import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProjectAuxiliaryPanel } from "./ProjectAuxiliaryPanel";

export function MainGitPanel() {
  const terminalPosition = useSharedSettings((s) => s.terminalPosition);

  const isTerminalRight = terminalPosition === "right";

  if (isTerminalRight) {
    return null;
  }

  return <ProjectAuxiliaryPanel includeTerminal={false} />;
}
