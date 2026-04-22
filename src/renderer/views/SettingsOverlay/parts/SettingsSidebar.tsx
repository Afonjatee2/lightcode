import {
  Archive,
  ArrowLeft,
  Bot,
  FlaskConical,
  Info,
  PanelLeft,
  PanelLeftClose,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { AgentStatus } from "@/shared/contracts";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { SidebarButton } from "@/renderer/components/common";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import { isDevApp } from "@/renderer/bridge";
import type { SettingsSection } from "./types";

export function SettingsSidebar(props: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  installedAgents: AgentStatus[];
}) {
  const { activeSection, onSectionChange, onClose, installedAgents } = props;
  const { isCollapsed, collapse, expand } = useSidebar();
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  const isAgentsActive = activeSection === "agents" || activeSection.startsWith("agents:");
  const devMode = isDevApp();

  const selectFirstAgent = () => {
    const first = installedAgents[0];
    onSectionChange(first ? `agents:${first.kind}` : "agents");
  };

  return (
    <div className="relative h-full">
      {isCollapsed && (
        <div className="absolute inset-0 z-10 flex h-full min-h-0 flex-col items-start gap-3 pl-2 pb-1 pt-0">
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            <SidebarButton
              iconOnly
              icon={<Settings2 className="size-4" />}
              label="General"
              isActive={activeSection === "general"}
              onPress={() => onSectionChange("general")}
            />
            <SidebarButton
              iconOnly
              icon={<Sparkles className="size-4" />}
              label="AI"
              isActive={activeSection === "ai"}
              onPress={() => onSectionChange("ai")}
            />
            <SidebarButton
              iconOnly
              icon={<Bot className="size-4" />}
              label="Agents"
              isActive={isAgentsActive}
              onPress={selectFirstAgent}
            />
            {isAgentsActive &&
              installedAgents.map((agent) => (
                <SidebarButton
                  key={agent.kind}
                  iconOnly
                  icon={
                    <ProviderIcon
                      kind={agent.kind}
                      className={`size-4 ${disabledAgents.includes(agent.kind) ? "opacity-35" : ""}`}
                    />
                  }
                  label={agent.label}
                  isActive={activeSection === `agents:${agent.kind}`}
                  onPress={() => onSectionChange(`agents:${agent.kind}`)}
                />
              ))}
            <SidebarButton
              iconOnly
              icon={<Archive className="size-4" />}
              label="Archived Threads"
              isActive={activeSection === "archived"}
              onPress={() => onSectionChange("archived")}
            />
            <SidebarButton
              iconOnly
              icon={<Info className="size-4" />}
              label="About"
              isActive={activeSection === "about"}
              onPress={() => onSectionChange("about")}
            />
            {devMode && (
              <SidebarButton
                iconOnly
                icon={<FlaskConical className="size-4" />}
                label="Dev"
                isActive={activeSection === "dev"}
                onPress={() => onSectionChange("dev")}
              />
            )}
          </div>
          <div className="space-y-1 border-t border-white/6 pt-2 pr-2">
            <SidebarButton
              iconOnly
              icon={<ArrowLeft className="size-4" />}
              label="Return to app"
              onPress={onClose}
            />
            <SidebarButton
              iconOnly
              icon={<PanelLeft className="size-4" />}
              label="Show sidebar"
              onPress={expand}
            />
          </div>
        </div>
      )}

      <div
        className={`flex h-full min-h-0 flex-col gap-3 px-3 pb-1 pt-0 transition-opacity duration-150 ${isCollapsed ? "invisible opacity-0" : "opacity-100 delay-100"}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pr-0.5">
          <div className="space-y-0.5">
            <SidebarButton
              icon={<Settings2 className="size-4" />}
              label="General"
              isActive={activeSection === "general"}
              onPress={() => onSectionChange("general")}
            />
            <SidebarButton
              icon={<Sparkles className="size-4" />}
              label="AI"
              isActive={activeSection === "ai"}
              onPress={() => onSectionChange("ai")}
            />
            <SidebarButton
              icon={<Bot className="size-4" />}
              label="Agents"
              isActive={isAgentsActive && !activeSection.startsWith("agents:")}
              onPress={selectFirstAgent}
            />
            {isAgentsActive && (
              <div className="space-y-0.5 pl-4">
                {installedAgents.map((agent) => {
                  const agentDisabled = disabledAgents.includes(agent.kind);
                  return (
                    <SidebarButton
                      key={agent.kind}
                      icon={
                        <ProviderIcon
                          kind={agent.kind}
                          className={`size-4 ${agentDisabled ? "opacity-35" : ""}`}
                        />
                      }
                      label={agent.label}
                      className={agentDisabled ? "opacity-50" : ""}
                      isActive={activeSection === `agents:${agent.kind}`}
                      onPress={() => onSectionChange(`agents:${agent.kind}`)}
                    />
                  );
                })}
              </div>
            )}
            <SidebarButton
              icon={<Archive className="size-4" />}
              label="Archived Threads"
              isActive={activeSection === "archived"}
              onPress={() => onSectionChange("archived")}
            />
            <SidebarButton
              icon={<Info className="size-4" />}
              label="About"
              isActive={activeSection === "about"}
              onPress={() => onSectionChange("about")}
            />
            {devMode && (
              <SidebarButton
                icon={<FlaskConical className="size-4" />}
                label="Dev"
                isActive={activeSection === "dev"}
                onPress={() => onSectionChange("dev")}
              />
            )}
          </div>
        </div>

        <div className="space-y-1 border-t border-white/6 pt-2">
          <SidebarButton
            icon={<ArrowLeft className="size-4" />}
            label="Return to app"
            onPress={onClose}
          />
          <SidebarButton
            icon={<PanelLeftClose className="size-4" />}
            label="Hide sidebar"
            onPress={collapse}
          />
        </div>
      </div>
    </div>
  );
}
