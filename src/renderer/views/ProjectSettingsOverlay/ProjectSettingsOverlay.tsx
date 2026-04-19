import { useState } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { SettingsSidebar } from "./parts/SettingsSidebar";
import { GeneralSection } from "./parts/GeneralSection";
import { ScriptsSection } from "./parts/ScriptsSection";
import { ActionsSection } from "./parts/ActionsSection";
import type { ProjectSettingsSection } from "./parts/types";

export { resolveActionIcon } from "@/renderer/utils/actionIcons";

export function ProjectSettingsOverlay(props: { projectId: string; onClose: () => void }) {
  const { projectId, onClose } = props;
  const projectName = useAppStore(
    (s) => s.projects.find((p) => p.id === projectId)?.name ?? "Project",
  );
  const [activeSection, setActiveSection] = useState<ProjectSettingsSection>("general");

  return (
    <PageLayout
      title={`${projectName} Settings`}
      sidebar={
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onClose={onClose}
        />
      }
      content={
        activeSection === "general" ? (
          <GeneralSection projectId={projectId} />
        ) : activeSection === "worktrees" ? (
          <ScriptsSection projectId={projectId} />
        ) : activeSection === "actions" ? (
          <ActionsSection projectId={projectId} />
        ) : null
      }
    />
  );
}
