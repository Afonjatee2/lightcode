import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

export type DayPeriod = "morning" | "afternoon" | "evening" | "night";

export function resolveDayPeriod(date: Date): DayPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const periodGreeting: Record<DayPeriod, MessageDescriptor> = {
  morning: msg`Good morning`,
  afternoon: msg`Good afternoon`,
  evening: msg`Good evening`,
  night: msg`Hello`,
};

export function dayPeriodGreeting(period: DayPeriod): MessageDescriptor {
  return periodGreeting[period];
}

export const greetingAllClear = msg`You're all caught up.`;
