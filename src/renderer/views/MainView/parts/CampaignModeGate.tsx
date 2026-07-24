import { useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@heroui/react";
import { Code2 } from "lucide-react";
import { useProject } from "@/renderer/state/useThread";
import { getProjectPurpose } from "@/shared/contracts/project";
import { CampaignWorkspaceShell } from "@/renderer/views/CampaignWorkspace/CampaignWorkspaceShell";

/**
 * Gates code-specific UI (git, worktree, PR, commit, code-explorer) behind
 * campaign mode. When the active project is a campaign project, the live
 * campaign workspace shell (monitoring, threads, context) is shown instead
 * of the standard code pane, unless the operator toggles "Advanced mode".
 */
export function CampaignModeGate(props: { projectId: string; children: ReactNode }) {
  const { t } = useLingui();
  const project = useProject(props.projectId);
  const [advancedMode, setAdvancedMode] = useState(false);

  if (!project || getProjectPurpose(project) !== "campaign") {
    return <>{props.children}</>;
  }

  if (advancedMode) {
    return (
      <div className="relative h-full">
        <div className="absolute top-2 right-2 z-30">
          <Button size="sm" variant="secondary" onPress={() => setAdvancedMode(false)}>
            <Code2 className="size-3.5" />
            {t`Back to Campaign`}
          </Button>
        </div>
        {props.children}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div className="absolute top-2 right-2 z-30">
        <Button size="sm" variant="secondary" onPress={() => setAdvancedMode(true)}>
          <Code2 className="size-4" />
          {t`Advanced Mode (Code)`}
        </Button>
      </div>
      <CampaignWorkspaceShell projectId={props.projectId} />
    </div>
  );
}
