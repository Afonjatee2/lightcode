import { Trans, useLingui } from "@lingui/react/macro";
import { Tabs } from "@heroui/react";
import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";
import { openThread } from "@/renderer/actions/threadActions";
import { ConsultationDock } from "@/renderer/components/consultations";
import { useConsultationStore } from "@/renderer/components/consultations/consultationStore";
import { useProjectThreads } from "@/renderer/hooks/uiSelectors";
import { CampaignThreadComposer } from "./CampaignThreadComposer";
import { resolvePrimaryCampaignThread } from "./campaignThreadComposerRouting";

export function CampaignThreadPane(props: {
  projectId: string;
  identity: CampaignContextIdentityViewModel | null;
}) {
  const { t } = useLingui();
  const projectThreads = useProjectThreads(props.projectId);
  const primaryThread = resolvePrimaryCampaignThread(projectThreads);
  const threadId = primaryThread?.id;
  const hasConsultations = useConsultationStore((state) =>
    threadId
      ? [...state.records.values()].some((record) => record.parentThreadId === threadId)
      : false,
  );

  const tabs = [
    { id: "monitoring", label: t`Monitoring` },
    { id: "pacing", label: t`Pacing` },
    { id: "plan_revision", label: t`Plan Revision` },
    { id: "client_update", label: t`Client Update` },
    { id: "eoc_report", label: t`EOC Report` },
    { id: "general", label: t`General` },
  ];

  if (!props.identity) {
    return (
      <div className="flex h-full items-center justify-center text-default-400">
        <p>
          <Trans>Select a campaign to view its thread</Trans>
        </p>
      </div>
    );
  }

  const clientDisplay = props.identity.clientName ?? "—";
  const campaignDisplay = props.identity.campaignName;
  const defaultProvider = primaryThread?.agentKind ?? "claude";

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-divider px-3 py-2">
        <h3 className="text-small font-medium text-foreground">
          {clientDisplay} – {campaignDisplay}
        </h3>
      </header>

      <Tabs
        aria-label={t`Thread topics`}
        variant="secondary"
        className="shrink-0 border-b border-divider px-2"
      >
        <Tabs.ListContainer>
          <Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.id} id={tab.id}>
                {tab.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {threadId ? (
            <ConsultationDock
              threadId={threadId}
              onOpenThread={(childThreadId) => openThread(childThreadId)}
            />
          ) : null}
          {!hasConsultations ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 text-default-400">
              <p className="text-center text-small">
                <Trans>
                  Consultation results appear here. Use @codex, @verify, @panel, and other mentions
                  in the composer below.
                </Trans>
              </p>
            </div>
          ) : null}
        </div>

        <CampaignThreadComposer
          projectId={props.projectId}
          parentThreadId={threadId}
          campaignGroupId={props.identity.campaignGroupId}
          defaultProvider={defaultProvider}
        />
      </div>
    </div>
  );
}
