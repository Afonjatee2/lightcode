import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { MCP_PROFILES, type McpProfile, type McpServer } from "@/shared/contracts";
import { getCampaignMcpProfile, getProjectPurpose } from "@/shared/contracts/project";
import { McpServersManager } from "@/renderer/components/mcp/McpServersManager";
import { Select } from "@/renderer/components/common/Select";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { isHomeProject } from "@/shared/homeScope";
import { SettingRow, SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";

const MCP_PROFILE_LABELS: Record<McpProfile, MessageDescriptor> = {
  monitoring: msg`Monitoring (read-only)`,
  plan_revision: msg`Plan Revision`,
  client_comms: msg`Client Comms`,
  deployment: msg`Deployment`,
  development: msg`Development`,
};

function CampaignMcpProfileRow(props: { projectId: string }) {
  const { t } = useLingui();
  const project = useAppStore((state) =>
    state.projects.find((item) => item.id === props.projectId),
  );
  const userServers = useSharedSettings((state) => state.mcpServers);
  const profile = project ? getCampaignMcpProfile(project) : undefined;
  const updateProjectCampaignMcpProfile = useAppStore(
    (state) => state.updateProjectCampaignMcpProfile,
  );

  if (!project || !profile) return null;

  const ccServer =
    project.mcpServers?.find((s) => s.name === "control-centre") ??
    userServers.find((s) => s.name === "control-centre");
  const isRemote = ccServer ? ccServer.transport.type !== "stdio" : false;

  const description = isRemote
    ? t`The active remote Control Centre profile is managed by the remote server administrator. Remote servers do not support client-controlled profile reconfiguration.`
    : t`Selects which Control Centre tool subset the "control-centre" MCP server exposes for this campaign project. Changes apply when Poracode next starts or reconnects to a newly launched MCP process.`;

  return (
    <SettingRow title={t`Control Centre MCP Profile`} description={description}>
      <Select
        aria-label={t`Control Centre MCP Profile`}
        value={profile}
        isDisabled={isRemote}
        onChange={(value) => updateProjectCampaignMcpProfile(props.projectId, value as McpProfile)}
        options={MCP_PROFILES.map((id) => ({ id, label: t(MCP_PROFILE_LABELS[id]) }))}
      />
    </SettingRow>
  );
}

export function McpSection(props: { projectId: string }) {
  const { t } = useLingui();
  const project = useAppStore((state) =>
    state.projects.find((item) => item.id === props.projectId),
  );
  const projects = useAppStore((state) => state.projects);
  const updateProjectMcpServers = useAppStore((state) => state.updateProjectMcpServers);
  const userServers = useSharedSettings((state) => state.mcpServers);
  const setUserServers = useSharedSettings((state) => state.setMcpServers);

  if (!project) return null;
  const isCampaignProject = getProjectPurpose(project) === "campaign";

  const importProjects = projects
    .filter((item) => !isHomeProject(item))
    .map((item) => ({
      id: item.id,
      name: item.name,
      location: item.location,
      servers: item.mcpServers ?? [],
      onChange: (servers: McpServer[]) => updateProjectMcpServers(item.id, servers),
    }));

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <SettingsPage
        title={t`MCP Servers`}
        description={t`Workspace MCP servers override user servers with the same name and are added only when agents start in this project.`}
        bodyClassName="space-y-5"
      >
        {isCampaignProject && <CampaignMcpProfileRow projectId={project.id} />}
        <McpServersManager
          sources={{
            user: { servers: userServers, onChange: setUserServers },
            workspace: {
              servers: project.mcpServers ?? [],
              projectId: project.id,
              projectLocation: project.location,
              projectName: project.name,
              onChange: (servers) => updateProjectMcpServers(project.id, servers),
            },
          }}
          importProjects={importProjects}
          defaultScope="workspace"
        />
      </SettingsPage>
    </div>
  );
}
