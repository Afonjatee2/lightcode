import { z } from "zod";

export const PERFORMANCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const PERFORMANCE_SNAPSHOT_DIR = ".cockpit";
export const PERFORMANCE_SNAPSHOT_FILENAME = "performance-snapshot.json";

export const performanceSnapshotChannelStatusSchema = z.enum(["on_track", "at_risk", "no_data"]);
export type PerformanceSnapshotChannelStatus = z.infer<
  typeof performanceSnapshotChannelStatusSchema
>;

export const performanceSnapshotChannelSchema = z
  .object({
    channel: z.string().min(1),
    spend: z.number().optional(),
    budget: z.number().optional(),
    impressions: z.number().optional(),
    impressionsTarget: z.number().optional(),
    clicks: z.number().optional(),
    conversions: z.number().optional(),
    videoViews: z.number().optional(),
    status: performanceSnapshotChannelStatusSchema.optional(),
  })
  .strip();
export type PerformanceSnapshotChannel = z.infer<typeof performanceSnapshotChannelSchema>;

export const performanceSnapshotKpiSchema = z
  .object({
    label: z.string().min(1),
    actual: z.number().optional(),
    target: z.number().optional(),
    pctAchieved: z.number().optional(),
    status: performanceSnapshotChannelStatusSchema.optional(),
  })
  .strip();
export type PerformanceSnapshotKpi = z.infer<typeof performanceSnapshotKpiSchema>;

export const performanceSnapshotSchema = z
  .object({
    schemaVersion: z.literal(PERFORMANCE_SNAPSHOT_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    source: z.string().min(1),
    periodStart: z.string().optional(),
    periodEnd: z.string().optional(),
    headline: z.string().optional(),
    channels: z.array(performanceSnapshotChannelSchema),
    kpis: z.array(performanceSnapshotKpiSchema).optional(),
    notes: z.array(z.string()).optional(),
  })
  .strip();
export type PerformanceSnapshot = z.infer<typeof performanceSnapshotSchema>;

/**
 * Tolerant parse for agent-written snapshot files. Unknown keys are stripped;
 * invalid payloads return null (caller should warn, never throw).
 */
export function parsePerformanceSnapshotJson(raw: unknown): PerformanceSnapshot | null {
  const parsed = performanceSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parsePerformanceSnapshotFileContents(contents: string): PerformanceSnapshot | null {
  try {
    const json: unknown = JSON.parse(contents);
    return parsePerformanceSnapshotJson(json);
  } catch {
    return null;
  }
}
