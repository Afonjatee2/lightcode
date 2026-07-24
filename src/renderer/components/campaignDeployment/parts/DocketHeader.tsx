import { Alert, Button, Chip } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { FileText, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import {
  formatDocketDateTime,
  type ActionProposalViewModel,
  type ProposalRiskLevel,
  type ProposalStatus,
} from "../actionProposalViewModel";
import {
  docketStrings,
  proposalRiskStrings,
  proposalStatusStrings,
} from "../approvalDocketStrings";

const STATUS_CHIP_COLOR: Record<
  ProposalStatus,
  "default" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "default",
  awaiting_approval: "warning",
  approved: "success",
  rejected: "danger",
  applying: "accent",
  applied: "success",
  failed: "danger",
  cancelled: "default",
};

const RISK_CHIP_COLOR: Record<ProposalRiskLevel, "success" | "warning" | "danger"> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

function MetaItem(props: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="cockpit-klabel">{props.label}</dt>
      <dd
        className={`mt-0.5 truncate text-sm text-foreground ${props.mono ? "font-mono text-xs" : ""}`}
        title={typeof props.value === "string" ? props.value : undefined}
      >
        {props.value}
      </dd>
    </div>
  );
}

/**
 * Docket masthead: kicker + proposal id, title, summary, status/risk chips,
 * and the campaign/client identity block. Presentational only.
 */
export function DocketHeader(props: {
  proposal: ActionProposalViewModel;
  isExpired: boolean;
  refreshPending: boolean;
  onRefreshPress: () => void;
}) {
  const { t } = useLingui();
  const { proposal } = props;
  const entityDisplay = proposal.target.entityName ?? proposal.target.entityId;

  return (
    <header className="border-t-2 border-[var(--cockpit-accent)] pt-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cockpit-accent-soft)] text-[var(--cockpit-accent)]">
          <FileText className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="cockpit-klabel">
            {t(docketStrings.docketKicker)} ·{" "}
            <span className="font-mono normal-case tracking-normal">{proposal.id}</span>
          </p>
          <h1 className="mt-1 text-[21px] font-bold leading-tight tracking-tight text-foreground">
            {proposal.title}
          </h1>
          {proposal.summary ? (
            <p className="mt-1 max-w-prose text-sm text-muted">{proposal.summary}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip size="sm" variant="soft" color={RISK_CHIP_COLOR[proposal.risk.level]}>
              {t(proposalRiskStrings[proposal.risk.level])}
            </Chip>
            <Chip size="sm" variant="soft" color={STATUS_CHIP_COLOR[proposal.status]}>
              {t(proposalStatusStrings[proposal.status])}
            </Chip>
          </div>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t(docketStrings.refreshProposal)}
          aria-busy={props.refreshPending}
          isDisabled={props.refreshPending}
          onPress={props.onRefreshPress}
        >
          <RefreshCw className={`size-4 ${props.refreshPending ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {props.isExpired ? (
        <Alert status="warning" className="mt-3">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t(docketStrings.expiredWarning)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetaItem label={t(docketStrings.clientLabel)} value={proposal.clientName} />
        <MetaItem label={t(docketStrings.campaignLabel)} value={proposal.campaignName} />
        {proposal.jobNumber ? (
          <MetaItem label={t(docketStrings.jobNumberLabel)} value={proposal.jobNumber} mono />
        ) : null}
        <MetaItem label={t(docketStrings.platformLabel)} value={proposal.target.platform} />
        <MetaItem
          label={t(docketStrings.entityLabel)}
          value={`${proposal.target.entityType} · ${entityDisplay}`}
          mono
        />
        <MetaItem label={t(docketStrings.actionTypeLabel)} value={proposal.actionType} mono />
        <MetaItem
          label={t(docketStrings.createdByLabel)}
          value={proposal.createdByAgent ?? t`Unknown`}
        />
        <MetaItem
          label={t(docketStrings.createdLabel)}
          value={formatDocketDateTime(proposal.createdAt)}
        />
        <MetaItem
          label={t(docketStrings.expiresLabel)}
          value={
            proposal.expiresAt ? formatDocketDateTime(proposal.expiresAt) : t(docketStrings.no)
          }
        />
      </dl>
    </header>
  );
}
