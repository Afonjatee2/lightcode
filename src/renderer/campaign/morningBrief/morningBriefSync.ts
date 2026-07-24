import { msg } from "@lingui/core/macro";
import type { ScheduledTask, ScheduledTaskInput } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { i18n } from "@/renderer/i18n/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { type MorningBrief, filterNewExceptions } from "./briefGenerator";

const SCHEDULE_NAME = "Campaign Morning Brief";

export async function syncMorningBriefSchedule(enabled: boolean, time: string): Promise<void> {
  const settings = useSharedSettings.getState();
  const scheduleId = settings.morningBriefScheduleId;

  try {
    const tasks = await readBridge().getSchedules();
    let existingTask: ScheduledTask | undefined;
    if (scheduleId) {
      existingTask = tasks.find((t) => t.id === scheduleId);
    }
    if (!existingTask) {
      existingTask = tasks.find(
        (t) => t.name === SCHEDULE_NAME || t.name === i18n._(msg`Campaign Morning Brief`),
      );
    }

    if (enabled) {
      const input: ScheduledTaskInput = {
        name: i18n._(msg`Campaign Morning Brief`),
        prompt: i18n._(msg`Generate daily campaign morning brief and exception notifications.`),
        agentKind: existingTask?.agentKind ?? "claude",
        config: existingTask?.config ?? { model: "claude-3-5-sonnet-latest" },
        recurrence: {
          kind: "weekly",
          days: [0, 1, 2, 3, 4, 5, 6],
          time,
        },
        enabled: true,
      };

      if (existingTask) {
        const updated = await readBridge().updateSchedule({ id: existingTask.id, task: input });
        if (settings.morningBriefScheduleId !== updated.id) {
          settings.setMorningBriefScheduleId(updated.id);
        }
      } else {
        const created = await readBridge().createSchedule(input);
        settings.setMorningBriefScheduleId(created.id);
      }
    } else if (existingTask && existingTask.enabled) {
      const input: ScheduledTaskInput = {
        name: existingTask.name,
        prompt: existingTask.prompt,
        agentKind: existingTask.agentKind,
        config: existingTask.config,
        recurrence: existingTask.recurrence,
        enabled: false,
        ...(existingTask.projectId ? { projectId: existingTask.projectId } : {}),
      };
      await readBridge().updateSchedule({ id: existingTask.id, task: input });
    }
  } catch (error) {
    // Graceful error handling for schedule sync
    console.error("Failed to sync morning brief schedule:", error);
  }
}

/**
 * Evaluates the brief exceptions and triggers restrained OS notifications
 * for any unnotified exception items.
 */
export function processMorningBriefNotifications(brief: MorningBrief): void {
  const settings = useSharedSettings.getState();
  if (!settings.morningBriefEnabled || !settings.notificationsEnabled) return;
  if (!brief.hasExceptions) return;

  const notifiedKeys = new Set(settings.morningBriefNotifiedKeys);
  const newExceptions = filterNewExceptions(brief.exceptions, notifiedKeys);

  if (newExceptions.length === 0) return;

  const newlyNotifiedKeys: string[] = [];

  for (const item of newExceptions) {
    const title = i18n._(msg`Campaign Exception: ${item.clientName} · ${item.campaignName}`);
    const body = item.reason;

    void readBridge()
      .showNotification({ title, body })
      .catch(() => undefined);

    newlyNotifiedKeys.push(item.id);
  }

  if (newlyNotifiedKeys.length > 0) {
    settings.addMorningBriefNotifiedKeys(newlyNotifiedKeys);
  }
}
