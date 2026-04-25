import { useState } from "react";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { PageLayout } from "@/renderer/components/layout/PageLayout";
import { GeneralSettings } from "./parts/GeneralSettings";
import { AISettings } from "./parts/AISettings";
import { SearchSettings } from "./parts/SearchSettings";
import { ArchivedThreadsSettings } from "./parts/ArchivedThreadsSettings";
import { AboutSettings } from "./parts/AboutSettings";
import { DevSettings } from "./parts/DevSettings";
import { SettingsSidebar } from "./parts/SettingsSidebar";
import { AgentSettingsEmpty, SingleAgentSettings } from "./parts/SingleAgentSettings";
import type { SettingsSection } from "./parts/types";

export function SettingsOverlay(props: { onClose: () => void }) {
  const { onClose } = props;
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const agentStatuses = useAgentStatusesStore((s) => s.agentStatuses);
  const installedAgents = agentStatuses.filter((a) => a.installed);

  const agentKind = activeSection.startsWith("agents:") ? activeSection.slice(7) : undefined;

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
      content={
        activeSection === "general" ? (
          <GeneralSettings />
        ) : activeSection === "ai" ? (
          <AISettings />
        ) : activeSection === "search" ? (
          <SearchSettings />
        ) : agentKind ? (
          <SingleAgentSettings agentKind={agentKind} />
        ) : activeSection === "agents" ? (
          <AgentSettingsEmpty />
        ) : activeSection === "archived" ? (
          <ArchivedThreadsSettings />
        ) : activeSection === "about" ? (
          <AboutSettings />
        ) : activeSection === "dev" ? (
          <DevSettings />
        ) : null
      }
    />
  );
}
