import type { CampaignContextAlertViewModel } from "@/renderer/adapters/campaignViewModels";

export interface GroupedAlert {
  key: string;
  title: string;
  severity: string;
  priority: "P1" | "P2" | "P3" | "P4";
  count: number;
  instances: CampaignContextAlertViewModel[];
}

const priorityRank: Record<string, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

const severityRank: Record<string, number> = {
  critical: 1,
  warning: 2,
  info: 3,
  default: 4,
};

export function groupAlerts(alerts: CampaignContextAlertViewModel[]): GroupedAlert[] {
  const map = new Map<string, GroupedAlert>();

  for (const alert of alerts) {
    const key = `${alert.severity}:${alert.title}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.instances.push(alert);
      if ((priorityRank[alert.priority] ?? 99) < (priorityRank[existing.priority] ?? 99)) {
        existing.priority = alert.priority;
      }
    } else {
      map.set(key, {
        key,
        title: alert.title,
        severity: alert.severity,
        priority: alert.priority,
        count: 1,
        instances: [alert],
      });
    }
  }

  const grouped = Array.from(map.values());

  grouped.sort((a, b) => {
    const aSev = severityRank[a.severity.toLowerCase()] ?? priorityRank[a.priority] ?? 99;
    const bSev = severityRank[b.severity.toLowerCase()] ?? priorityRank[b.priority] ?? 99;

    if (aSev !== bSev) {
      return aSev - bSev;
    }

    if (a.count !== b.count) {
      return b.count - a.count;
    }

    return a.title.localeCompare(b.title);
  });

  return grouped;
}
