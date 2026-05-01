import { useState, type ReactNode } from "react";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { GeneralSettings } from "./parts/GeneralSettings";
import { NotificationSettings } from "./parts/NotificationSettings";
import { AISettings } from "./parts/AISettings";
import { SearchSettings } from "./parts/SearchSettings";
import { ArchivedThreadsSettings } from "./parts/ArchivedThreadsSettings";
import { AboutSettings } from "./parts/AboutSettings";
import { DevSettings } from "./parts/DevSettings";
import { SettingsSidebar } from "./parts/SettingsSidebar";
import { AgentSettingsEmpty, SingleAgentSettings } from "./parts/SingleAgentSettings";
import type { SettingsSection } from "./parts/types";

const SECTION_VIEWS: Partial<Record<SettingsSection, () => ReactNode>> = {
  general: () => <GeneralSettings />,
  notifications: () => <NotificationSettings />,
  ai: () => <AISettings />,
  search: () => <SearchSettings />,
  agents: () => <AgentSettingsEmpty />,
  archived: () => <ArchivedThreadsSettings />,
  about: () => <AboutSettings />,
  dev: () => <DevSettings />,
};

function renderSection(activeSection: SettingsSection): ReactNode {
  if (activeSection.startsWith("agents:")) {
    return <SingleAgentSettings agentKind={activeSection.slice(7)} />;
  }
  return SECTION_VIEWS[activeSection]?.() ?? null;
}

export function SettingsOverlay(props: { onClose: () => void }) {
  const { onClose } = props;
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const installedAgents = agentStatuses.filter((a) => a.installed);

  return (
    <PageLayout
      title="Settings"
      sidebar={
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          onClose={onClose}
          installedAgents={installedAgents}
        />
      }
      content={renderSection(activeSection)}
    />
  );
}
