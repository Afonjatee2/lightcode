import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Chip, Spinner } from "@heroui/react";
import { Plus } from "lucide-react";
import type { CampaignDecisionViewModel } from "@/renderer/adapters/campaignViewModels";
import type { CampaignDecisionsState } from "@/renderer/hooks/useCampaignDecisions";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function DecisionRow(props: { decision: CampaignDecisionViewModel; muted?: boolean }) {
  const { decision } = props;
  const { t } = useLingui();
  const window =
    decision.expiresAt !== null
      ? `${formatDate(decision.startsAt)} → ${formatDate(decision.expiresAt)}`
      : t`${formatDate(decision.startsAt)} → no expiry`;

  return (
    <li
      className={`border-t border-[var(--hairline)] pt-2 first:border-0 first:pt-0 ${
        props.muted ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{decision.title}</span>
        {props.muted ? (
          <Chip size="sm" variant="soft" color="default">
            {decision.effectiveStatus === "revoked" ? t`Revoked` : t`Expired`}
          </Chip>
        ) : null}
      </div>
      {decision.description ? (
        <p className="mt-0.5 text-[11.5px] text-muted">{decision.description}</p>
      ) : null}
      <p className="mt-0.5 text-[10.5px] tabular-nums text-muted">{window}</p>
    </li>
  );
}

/**
 * Renders active campaign decisions with their validity window, plus any
 * expired/revoked ones kept plainly below (never presented as active). Active
 * vs. past is decided entirely by the server's `effectiveStatus`.
 *
 * The context payload carries no alert→decision relationship, so decisions are
 * shown on their own terms; alerts are not annotated as "explained by" a
 * specific decision here.
 */
export function CampaignDecisionsList(props: {
  decisions: CampaignDecisionsState;
  ready: boolean;
  onRecord: () => void;
}) {
  const { t } = useLingui();
  const { decisions } = props;

  const active: CampaignDecisionViewModel[] =
    decisions.status === "ready" ? decisions.data.filter((d) => d.isActive) : [];
  const past: CampaignDecisionViewModel[] =
    decisions.status === "ready" ? decisions.data.filter((d) => !d.isActive) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-foreground">
          {decisions.status === "ready" ? (
            <Trans>{active.length} active decisions</Trans>
          ) : (
            <Trans>Active decisions</Trans>
          )}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[var(--cockpit-accent)]"
          onPress={props.onRecord}
          isDisabled={!props.ready}
          aria-label={t`Record a decision`}
        >
          <Plus className="size-3.5" aria-hidden />
          <Trans>Record</Trans>
        </Button>
      </div>

      {decisions.status === "loading" ? (
        <p className="flex items-center gap-1.5 text-muted">
          <Spinner size="sm" />
          <Trans>Loading decisions…</Trans>
        </p>
      ) : null}

      {decisions.status === "ready" && active.length > 0 ? (
        <ul className="space-y-2">
          {active.map((decision) => (
            <DecisionRow key={decision.id} decision={decision} />
          ))}
        </ul>
      ) : null}

      {decisions.status === "ready" && active.length === 0 ? (
        <p className="text-muted">
          <Trans>No active decisions.</Trans>
        </p>
      ) : null}

      {past.length > 0 ? (
        <div className="mt-1">
          <p className="cockpit-klabel !text-[10px] !tracking-[0.07em] text-muted">
            <Trans>Past decisions</Trans>
          </p>
          <ul className="mt-1 space-y-2">
            {past.map((decision) => (
              <DecisionRow key={decision.id} decision={decision} muted />
            ))}
          </ul>
        </div>
      ) : null}

      {decisions.status === "unauthorized" ? (
        <p className="text-muted">
          <Trans>Control Centre needs authorization to list decisions.</Trans>
        </p>
      ) : null}
      {decisions.status === "unavailable" || decisions.status === "error" ? (
        <p className="text-muted">{decisions.message}</p>
      ) : null}
    </div>
  );
}
