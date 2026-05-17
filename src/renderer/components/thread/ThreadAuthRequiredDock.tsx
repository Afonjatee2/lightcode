import { useState } from "react";
import { toast } from "@heroui/react";
import { KeyRound, LogIn, RefreshCw, Settings } from "lucide-react";
import type { AgentStatus, Project } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { runAgentLoginCommand } from "@/renderer/actions/agentLoginActions";
import { openSettings } from "@/renderer/actions/panelActions";
import { Button } from "@/renderer/components/common";
import { useAppStore } from "@/renderer/state/appStore";
import { buildWslProjectDistrosKey } from "@/renderer/state/projectKeys";
import {
  acpGenericInstanceId,
  agentAuthTarget,
  findAgentAuthMethodForStatus,
  scopeEnvForStatus,
} from "@/renderer/utils/acpRegistryAuth";
import { ThreadDockHeader, ThreadDockSection } from "./ThreadDockUI";

function currentWslDistros(): string[] {
  const key = buildWslProjectDistrosKey(useAppStore.getState().projects);
  return key ? key.split("\0") : [];
}

async function refreshAgentStatus(status: AgentStatus): Promise<void> {
  await readBridge().refreshAgentStatuses(currentWslDistros(), {
    agentKinds: [status.kind],
    envs: [scopeEnvForStatus(status)],
  });
}

export function ThreadAuthRequiredDock(props: { agentStatus: AgentStatus; project?: Project }) {
  const { agentStatus, project } = props;
  const [pendingAction, setPendingAction] = useState<"login" | "refresh" | undefined>();
  const agentAuthMethod = findAgentAuthMethodForStatus(agentStatus);
  const registryAgentId = acpGenericInstanceId(agentStatus.kind);
  const canUseAgentAuth = agentAuthMethod !== undefined && registryAgentId !== undefined;
  const canUseTerminalLogin = Boolean(agentStatus.loginCommand);
  const hasDirectLogin = canUseAgentAuth || canUseTerminalLogin;
  const description = agentAuthMethod
    ? `Complete ${agentAuthMethod.name} sign-in before this thread can run.`
    : agentStatus.loginCommand
      ? `Run ${agentStatus.loginCommand} before this thread can run.`
      : "Add credentials before this thread can run.";

  async function handleLogin() {
    if (pendingAction) return;
    if (canUseAgentAuth) {
      setPendingAction("login");
      try {
        await readBridge().authenticateAcpRegistryAgent({
          agentId: registryAgentId,
          methodId: agentAuthMethod.id,
          ...agentAuthTarget(agentStatus),
        });
        void readBridge().focusWindow();
        await refreshAgentStatus(agentStatus);
        toast.success(`${agentStatus.label} authenticated.`);
      } catch (error) {
        toast.danger(
          error instanceof Error ? error.message : `Unable to authenticate ${agentStatus.label}.`,
        );
      } finally {
        setPendingAction(undefined);
      }
      return;
    }

    if (agentStatus.loginCommand) {
      runAgentLoginCommand({
        label: agentStatus.label,
        command: agentStatus.loginCommand,
        ...(project ? { project } : {}),
      });
    }
  }

  async function handleRefresh() {
    if (pendingAction) return;
    setPendingAction("refresh");
    try {
      await refreshAgentStatus(agentStatus);
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : `Unable to refresh ${agentStatus.label}.`,
      );
    } finally {
      setPendingAction(undefined);
    }
  }

  return (
    <ThreadDockSection placement="composer" collapsed={false} ariaLabel="Authentication required">
      <ThreadDockHeader
        icon={KeyRound}
        iconClassName="text-warning"
        title="Sign in required"
        actions={
          <div className="flex shrink-0 items-center gap-1">
            {hasDirectLogin ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 min-w-0 px-2 text-xs"
                isDisabled={pendingAction !== undefined}
                isPending={pendingAction === "login"}
                onPress={() => void handleLogin()}
              >
                <LogIn className="size-3.5" />
                Login
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="h-6 min-w-0 px-2 text-xs"
                onPress={openSettings}
              >
                <Settings className="size-3.5" />
                Settings
              </Button>
            )}
            <Button
              isIconOnly
              aria-label={`Refresh ${agentStatus.label} authentication`}
              size="sm"
              variant="ghost"
              className="h-6 w-6 min-w-0 text-muted"
              isDisabled={pendingAction !== undefined}
              isPending={pendingAction === "refresh"}
              onPress={() => void handleRefresh()}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        }
      >
        <span className="min-w-0 flex-1 truncate leading-5 text-[color:var(--muted)]">
          {agentStatus.label}: {description}
        </span>
      </ThreadDockHeader>
    </ThreadDockSection>
  );
}
