import { ChevronRight, Megaphone } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarProjectSection } from "./SidebarProjectSection";
import { CAMPAIGNS_SIDEBAR_SECTION_KEY } from "./partitionSidebarProjects";
import type { ThreadSortMode } from "./sortMode";

export function SidebarCampaignsSection(props: {
  campaignProjectIds: readonly string[];
  sortMode: ThreadSortMode;
  codeProjectCount: number;
}) {
  const { t } = useLingui();
  const appView = useAppStore((s) => s.view);
  const openCampaignToday = useAppStore((s) => s.openCampaignToday);
  const isCollapsed = useSidebarUiStore(
    (s) => s.collapsedProjects[CAMPAIGNS_SIDEBAR_SECTION_KEY] ?? false,
  );
  const toggleProjectCollapsed = useSidebarUiStore((s) => s.toggleProjectCollapsed);

  if (props.campaignProjectIds.length === 0) return null;

  return (
    <section className="space-y-0.5">
      <SidebarButton
        icon={
          <button
            type="button"
            aria-label={t`Toggle campaigns section`}
            className="flex shrink-0 items-center justify-center"
            onClick={(event) => {
              event.stopPropagation();
              toggleProjectCollapsed(CAMPAIGNS_SIDEBAR_SECTION_KEY);
            }}
          >
            <ChevronRight
              className={`size-3.5 text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            />
          </button>
        }
        label={
          <span className="flex items-center gap-1.5">
            <Megaphone className="size-3.5 shrink-0 text-muted" />
            <span className="truncate text-xs font-semibold text-foreground">
              <Trans>Campaigns</Trans>
            </span>
          </span>
        }
        isActive={appView.kind === "campaignToday"}
        className="poracode-sidebar-project-nudge !pl-1"
        onPress={() => openCampaignToday()}
      />
      {isCollapsed
        ? null
        : props.campaignProjectIds.map((projectId, projectIndex) => (
            <SidebarProjectSection
              key={projectId}
              projectId={projectId}
              projectIndex={props.codeProjectCount + projectIndex}
              sortMode={props.sortMode}
            />
          ))}
    </section>
  );
}
