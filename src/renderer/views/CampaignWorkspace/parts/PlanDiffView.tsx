import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Alert, Button, Spinner } from "@heroui/react";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import type {
  PlanDiffProvenanceViewModel,
  PlanDiffRowKind,
  PlanDiffRowViewModel,
  PlanDiffViewModel,
} from "@/shared/contracts/campaign/planIntelligence";

export type PlanDiffFilter = "all" | "changed" | "added" | "removed" | "low";

function confidencePercent(value: number | null): number {
  if (value === null) return 0;
  return Math.round(value * 100);
}

function confidenceTone(value: number | null): "high" | "medium" | "low" | "unknown" {
  if (value === null) return "unknown";
  if (value >= 0.85) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

function rowMatchesFilter(row: PlanDiffRowViewModel, filter: PlanDiffFilter): boolean {
  if (filter === "all") return true;
  if (filter === "low") return row.lowConfidence;
  if (filter === "changed") return row.kind === "changed";
  if (filter === "added") return row.kind === "added";
  if (filter === "removed") return row.kind === "removed";
  return true;
}

function ChangeTag(props: { kind: PlanDiffRowKind }) {
  const className =
    props.kind === "changed"
      ? "bg-warning/15 text-warning"
      : props.kind === "added"
        ? "bg-success/15 text-success"
        : "bg-danger/15 text-danger";
  const label = props.kind === "changed" ? "chg" : props.kind === "added" ? "add" : "del";
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${className}`}
    >
      {label}
    </span>
  );
}

function ConfidenceBar(props: { value: number | null }) {
  const percent = confidencePercent(props.value);
  const tone = confidenceTone(props.value);
  const barClass =
    tone === "high"
      ? "bg-success"
      : tone === "medium"
        ? "bg-warning"
        : tone === "low"
          ? "bg-danger"
          : "bg-default-300";
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <div className="h-1.5 min-w-11 flex-1 overflow-hidden rounded-full bg-default-200">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-default-500">
        {props.value === null ? <Trans>Unattributed</Trans> : `${percent}%`}
      </span>
    </div>
  );
}

function ProvenancePanel(props: {
  row: PlanDiffRowViewModel;
  provenance: PlanDiffProvenanceViewModel;
}) {
  return (
    <div
      className="border-t border-divider bg-content1 px-4 py-3 text-sm"
      data-testid={`plan-diff-provenance-${props.row.id}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--cockpit-accent)]">
        <Trans>Cell-level provenance</Trans>
      </p>
      {props.provenance.cellLabel ? (
        <p className="mt-2 font-mono text-xs text-foreground">{props.provenance.cellLabel}</p>
      ) : (
        <p className="mt-2 text-xs text-default-500">
          <Trans>Source cell unattributed</Trans>
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-default-500">
            <Trans>Published value</Trans>
          </p>
          <p className="font-mono text-sm">{props.provenance.publishedValue}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-default-500">
            <Trans>Revised value</Trans>
          </p>
          <p className="font-mono text-sm">{props.provenance.revisedValue}</p>
        </div>
      </div>
      {props.provenance.matchedBy ? (
        <p className="mt-3 text-xs text-default-500">{props.provenance.matchedBy}</p>
      ) : null}
      {props.provenance.confidenceNote ? (
        <p className="mt-1 text-xs text-warning">{props.provenance.confidenceNote}</p>
      ) : null}
    </div>
  );
}

export function PlanDiffView(props: {
  viewModel: PlanDiffViewModel;
  filename: string;
  comparedAtLabel?: string;
  proposing?: boolean;
  onCreateProposal?: () => void;
  onOpenApprovals?: (proposalId: string) => void;
  createdProposalId?: string | null;
}) {
  const { t } = useLingui();
  const [filter, setFilter] = useState<PlanDiffFilter>("all");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(
    props.viewModel.rows[0]?.id ?? null,
  );

  const visibleRows = props.viewModel.rows.filter((row) => rowMatchesFilter(row, filter));
  const selectedRow = visibleRows.find((row) => row.id === selectedRowId) ?? visibleRows[0] ?? null;

  const filters: Array<{ id: PlanDiffFilter; label: string; count?: number }> = [
    { id: "all", label: t`All` },
    { id: "changed", label: t`Changed`, count: props.viewModel.summary.changed },
    { id: "added", label: t`Added`, count: props.viewModel.summary.added },
    { id: "removed", label: t`Removed`, count: props.viewModel.summary.removed },
    { id: "low", label: t`Low confidence`, count: props.viewModel.summary.lowConfidence },
  ];

  return (
    <div
      className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden"
      data-testid="plan-diff-view"
    >
      <div className="shrink-0 border-b border-divider px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <FileSpreadsheet className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{props.filename}</h3>
            <p className="text-xs text-default-500">
              <Trans>Parsed and compared against the published plan</Trans>
              {props.comparedAtLabel ? ` · ${props.comparedAtLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
            <span className="rounded-full border border-divider px-2.5 py-1">
              <Trans>Published</Trans>{" "}
              <span className="font-semibold text-foreground">{props.viewModel.baseLabel}</span>
            </span>
            <span aria-hidden>→</span>
            <span className="rounded-full border border-[var(--cockpit-accent-line)] bg-[var(--cockpit-accent-soft)] px-2.5 py-1 text-[var(--cockpit-accent)]">
              <Trans>Revised</Trans>{" "}
              <span className="font-semibold">{props.viewModel.candidateLabel}</span>
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs text-warning">
            <b>{props.viewModel.summary.changed}</b> <Trans>changed</Trans>
          </span>
          <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success">
            <b>{props.viewModel.summary.added}</b> <Trans>added</Trans>
          </span>
          <span className="rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-xs text-danger">
            <b>{props.viewModel.summary.removed}</b> <Trans>removed</Trans>
          </span>
          <span className="rounded-full border border-divider px-2.5 py-1 text-xs text-default-500">
            <b>{props.viewModel.summary.unchanged}</b> <Trans>unchanged</Trans>
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {filters.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-label={chip.count !== undefined ? `${chip.label} (${chip.count})` : chip.label}
                data-testid={`plan-diff-filter-${chip.id}`}
                className={`cockpit-chip ${filter === chip.id ? "border-[var(--cockpit-accent-line)] bg-[var(--cockpit-accent-soft)] text-foreground" : ""}`}
                onClick={() => setFilter(chip.id)}
              >
                {chip.label}
                {chip.count !== undefined ? ` (${chip.count})` : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      {props.viewModel.identical ? (
        <div className="px-5 py-4">
          <Alert status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                <Trans>No changes detected</Trans>
              </Alert.Title>
              <Alert.Description>
                <Trans>Control Centre reports the revised plan matches the published plan.</Trans>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-divider text-[10px] font-semibold uppercase tracking-[0.08em] text-default-500">
              <th className="w-10 px-2 py-2" aria-hidden="true" />
              <th className="px-2 py-2">
                <Trans>Line item</Trans>
              </th>
              <th className="px-2 py-2">
                <Trans>Field</Trans>
              </th>
              <th className="px-2 py-2">
                <Trans>Change</Trans>
              </th>
              <th className="px-2 py-2">
                <Trans>Source cell</Trans>
              </th>
              <th className="px-2 py-2">
                <Trans>Parser confidence</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-default-500">
                  <Trans>No rows match this filter.</Trans>
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <RowBlock
                  key={row.id}
                  row={row}
                  selected={selectedRow?.id === row.id}
                  onSelect={() => setSelectedRowId(row.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-divider px-5 py-4">
        {props.createdProposalId && props.onOpenApprovals ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-default-600">
              <Trans>Proposal created — review it in the approval docket.</Trans>
            </p>
            <Button
              size="sm"
              variant="primary"
              className="bg-[var(--cockpit-accent)] text-[#0e0e14]"
              data-testid="plan-diff-open-approvals"
              onPress={() => props.onOpenApprovals?.(props.createdProposalId!)}
            >
              <Trans>Review in approvals</Trans>
            </Button>
          </div>
        ) : props.onCreateProposal ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-default-500">
              <Trans>Only you can approve — nothing executes without it.</Trans>
            </p>
            <Button
              size="sm"
              variant="primary"
              className="bg-[var(--cockpit-accent)] text-[#0e0e14]"
              data-testid="plan-diff-create-proposal"
              isDisabled={Boolean(props.proposing)}
              onPress={props.onCreateProposal}
            >
              {props.proposing ? <Spinner size="sm" color="current" /> : null}
              <Trans>Create approval proposal</Trans>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RowBlock(props: { row: PlanDiffRowViewModel; selected: boolean; onSelect: () => void }) {
  return (
    <>
      <tr
        data-testid={`plan-diff-row-${props.row.id}`}
        className={`cursor-pointer border-b border-divider transition-colors ${props.selected ? "bg-[var(--cockpit-accent-soft)]" : "hover:bg-content2"}`}
        onClick={props.onSelect}
      >
        <td className="px-2 py-3 align-top">
          <ChangeTag kind={props.row.kind} />
        </td>
        <td className="px-2 py-3 align-top">
          <p className="font-semibold text-foreground">{props.row.lineItem}</p>
          {props.row.lineItemDetail ? (
            <p className="text-[10.5px] text-default-500">{props.row.lineItemDetail}</p>
          ) : null}
        </td>
        <td className="px-2 py-3 align-top text-default-600">{props.row.field}</td>
        <td className="px-2 py-3 align-top font-mono text-xs">
          <span className="text-default-500">{props.row.before}</span>
          <span className="mx-1 text-default-400">→</span>
          <span className="text-foreground">{props.row.after}</span>
        </td>
        <td className="px-2 py-3 align-top font-mono text-xs text-default-600">
          {props.row.sourceCell ?? <Trans>Unattributed</Trans>}
        </td>
        <td className="px-2 py-3 align-top">
          <ConfidenceBar value={props.row.parserConfidence} />
        </td>
      </tr>
      {props.selected && props.row.provenance ? (
        <tr>
          <td colSpan={6} className="p-0">
            <ProvenancePanel row={props.row} provenance={props.row.provenance} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PlanDiffViewHeader(props: { filename: string; onBack: () => void }) {
  const { t } = useLingui();
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-4 py-3">
      <Button
        size="sm"
        variant="ghost"
        aria-label={t`Back to thread`}
        onPress={props.onBack}
        className="text-[var(--cockpit-accent)]"
      >
        <ArrowLeft className="size-4" />
        <Trans>Back to thread</Trans>
      </Button>
      <div className="min-w-0">
        <h3 className="truncate text-small font-medium text-foreground">
          <Trans>Plan diff and provenance</Trans>
        </h3>
        <p className="truncate text-tiny text-default-500">{props.filename}</p>
      </div>
    </header>
  );
}
