import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@heroui/react";
import { Plus } from "lucide-react";
import type { OperationsTodayCampaignViewModel } from "@/renderer/adapters/campaignViewModels";
import type { OperationsTodayState } from "@/renderer/hooks/useOperationsToday";

export type CampaignNavBucket = "needsAttention" | "waitingForApproval" | "otherLive";

export interface CampaignSummary {
  id: string;
  client: string;
  name: string;
  bucket: CampaignNavBucket;
  alerts: number;
}

const bucketColors: Record<CampaignNavBucket, string> = {
  needsAttention: "bg-danger",
  waitingForApproval: "bg-warning",
  otherLive: "bg-success",
};

function toSummaries(
  campaigns: readonly OperationsTodayCampaignViewModel[],
  bucket: CampaignNavBucket,
): CampaignSummary[] {
  return campaigns.map((campaign) => ({
    id: campaign.campaignGroupId,
    client: campaign.clientName,
    name: campaign.campaignName,
    bucket,
    alerts: campaign.openAlertCount,
  }));
}

/** Derives the flat nav-pane list from a `get_operations_today` fetch state. */
export function campaignSummariesFromOperationsToday(
  state: OperationsTodayState,
): CampaignSummary[] {
  if (state.status !== "ready") return [];
  return [
    ...toSummaries(state.data.needsAttention, "needsAttention"),
    ...toSummaries(state.data.waitingForApproval, "waitingForApproval"),
    ...toSummaries(state.data.otherLive, "otherLive"),
  ];
}

export function CampaignNavPane(props: {
  operationsToday: OperationsTodayState;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewCampaign: () => void;
}) {
  const { t } = useLingui();
  const campaigns = campaignSummariesFromOperationsToday(props.operationsToday);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-divider px-3 py-3">
        <h2 className="text-small font-semibold text-foreground">
          <Trans>Campaigns</Trans>
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.operationsToday.status === "loading" && (
          <div className="flex items-center gap-2 px-3 py-4 text-tiny text-default-400">
            <Spinner size="sm" />
            <Trans>Loading campaigns…</Trans>
          </div>
        )}
        {props.operationsToday.status === "unauthorized" && (
          <p className="px-3 py-4 text-tiny text-default-400">
            <Trans>Control Centre needs authorization. Reconnect it in settings.</Trans>
          </p>
        )}
        {props.operationsToday.status === "unavailable" && (
          <p className="px-3 py-4 text-tiny text-default-400">{props.operationsToday.message}</p>
        )}
        {props.operationsToday.status === "error" && (
          <p className="px-3 py-4 text-tiny text-danger">{props.operationsToday.message}</p>
        )}
        {props.operationsToday.status === "ready" && campaigns.length === 0 && (
          <p className="px-3 py-4 text-tiny text-default-400">
            <Trans>No live campaigns in Control Centre.</Trans>
          </p>
        )}
        {props.operationsToday.status === "ready" && campaigns.length > 0 && (
          <nav className="space-y-1 p-2">
            {campaigns.map((c) => {
              const isActive = c.id === props.activeId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => props.onSelect(c.id)}
                  className={`flex w-full items-start gap-2 rounded-medium px-3 py-2 text-left transition-colors ${
                    isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-content2"
                  }`}
                >
                  <span
                    className={`mt-1.5 block size-2.5 shrink-0 rounded-full ${bucketColors[c.bucket]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small font-medium leading-snug">{c.client}</p>
                    <p className="truncate text-tiny text-default-500 leading-snug">{c.name}</p>
                  </div>
                  {c.alerts > 0 && (
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-danger-foreground">
                      {c.alerts}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      <div className="shrink-0 border-t border-divider p-2">
        <Button className="w-full" variant="primary" size="sm" onPress={props.onNewCampaign}>
          <Plus className="size-4" />
          {t`New Campaign Project`}
        </Button>
      </div>
    </div>
  );
}
