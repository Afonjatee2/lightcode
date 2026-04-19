import { ArrowLeft, GitFork, PanelLeft, PanelLeftClose, Play, Settings2 } from "lucide-react";
import { SidebarButton } from "@/renderer/components/common";
import { useSidebar } from "@/renderer/views/MainView/parts/AppShell/AppShell";
import type { ProjectSettingsSection } from "./types";

export function SettingsSidebar(props: {
  activeSection: ProjectSettingsSection;
  onSectionChange: (section: ProjectSettingsSection) => void;
  onClose: () => void;
}) {
  const { activeSection, onSectionChange, onClose } = props;
  const { isCollapsed, collapse, expand } = useSidebar();

  const sections: { id: ProjectSettingsSection; icon: React.ReactNode; label: string }[] = [
    { id: "general", icon: <Settings2 className="size-4" />, label: "General" },
    { id: "worktrees", icon: <GitFork className="size-4" />, label: "Worktrees" },
    { id: "actions", icon: <Play className="size-4" />, label: "Actions" },
  ];

  return (
    <div className="relative h-full">
      {isCollapsed && (
        <div className="absolute inset-0 z-10 flex h-full min-h-0 flex-col items-start gap-3 pl-2 pb-1 pt-0">
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {sections.map((s) => (
              <SidebarButton
                key={s.id}
                iconOnly
                icon={s.icon}
                label={s.label}
                isActive={activeSection === s.id}
                onPress={() => onSectionChange(s.id)}
              />
            ))}
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
            {sections.map((s) => (
              <SidebarButton
                key={s.id}
                icon={s.icon}
                label={s.label}
                isActive={activeSection === s.id}
                onPress={() => onSectionChange(s.id)}
              />
            ))}
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
