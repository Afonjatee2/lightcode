import { Trans, useLingui } from "@lingui/react/macro";
import { AlertTriangle, Ban, Database, DollarSign, WifiOff } from "lucide-react";
import type { EvidenceFreshnessSummary } from "@/shared/consultations";

interface ContextWarningsProps {
  evidenceFreshness: EvidenceFreshnessSummary | null;
  missingDataWarnings: string[];
  hasBudget: boolean;
  hasPlan: boolean;
  controlCentreAvailable: boolean;
  permissionRestricted: boolean;
}

export function ContextWarnings({
  evidenceFreshness,
  missingDataWarnings,
  hasBudget,
  hasPlan,
  controlCentreAvailable,
  permissionRestricted,
}: ContextWarningsProps) {
  const { t } = useLingui();

  const warnings: Array<{ key: string; icon: React.ReactNode; label: string }> = [];

  if (!controlCentreAvailable) {
    warnings.push({
      key: "cc-unavailable",
      icon: <WifiOff size={14} />,
      label: t`Control Centre connection unavailable`,
    });
  }

  if (!hasBudget) {
    warnings.push({
      key: "no-budget",
      icon: <DollarSign size={14} />,
      label: t`Budget data not available`,
    });
  }

  if (!hasPlan) {
    warnings.push({
      key: "no-plan",
      icon: <Database size={14} />,
      label: t`Campaign plan not available`,
    });
  }

  if (evidenceFreshness && evidenceFreshness.staleSourceCount > 0) {
    warnings.push({
      key: "stale-evidence",
      icon: <AlertTriangle size={14} />,
      label: t`${evidenceFreshness.staleSourceCount} stale data source(s)`,
    });
  }

  for (const w of missingDataWarnings) {
    warnings.push({
      key: `missing-${w}`,
      icon: <AlertTriangle size={14} />,
      label: w,
    });
  }

  if (permissionRestricted) {
    warnings.push({
      key: "perm-restricted",
      icon: <Ban size={14} />,
      label: t`Permission-restricted content hidden`,
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map((w) => (
        <span
          key={w.key}
          className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning"
        >
          {w.icon}
          {w.label}
        </span>
      ))}
    </div>
  );
}

export function EvidenceFreshnessIndicator({
  freshness,
}: {
  freshness: EvidenceFreshnessSummary;
}) {
  const oldest = freshness.oldestCapturedAt ? new Date(freshness.oldestCapturedAt) : null;
  const newest = freshness.newestCapturedAt ? new Date(freshness.newestCapturedAt) : null;

  if (!oldest || !newest) {
    return (
      <span className="text-xs text-muted-foreground">
        <Trans>Evidence freshness unknown</Trans>
      </span>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      <Trans>
        Evidence from {oldest.toLocaleDateString()} to {newest.toLocaleDateString()}
      </Trans>
    </span>
  );
}
