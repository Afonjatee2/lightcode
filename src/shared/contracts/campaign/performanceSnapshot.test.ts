import { describe, expect, it } from "vitest";
import {
  parsePerformanceSnapshotFileContents,
  parsePerformanceSnapshotJson,
  performanceSnapshotSchema,
} from "./performanceSnapshot";

const validSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-25T12:54:00.000Z",
  source: "control-centre get_plan_vs_actual",
  headline: "July pacing on track",
  channels: [
    {
      channel: "Meta",
      spend: 12000,
      budget: 15000,
      impressions: 450000,
      impressionsTarget: 500000,
      status: "on_track",
    },
  ],
  kpis: [{ label: "CPA", actual: 42, target: 50, pctAchieved: 84, status: "on_track" }],
};

describe("performanceSnapshot contract", () => {
  it("parses a valid snapshot", () => {
    const parsed = performanceSnapshotSchema.safeParse(validSnapshot);
    expect(parsed.success).toBe(true);
    expect(parsePerformanceSnapshotJson(validSnapshot)?.headline).toBe("July pacing on track");
  });

  it("strips unknown keys", () => {
    const withExtra = {
      ...validSnapshot,
      extraField: "ignored",
      channels: [{ channel: "Meta", unknown: true }],
    };
    const parsed = parsePerformanceSnapshotJson(withExtra);
    expect(parsed).not.toBeNull();
    expect("extraField" in (parsed as object)).toBe(false);
    expect("unknown" in parsed!.channels[0]!).toBe(false);
  });

  it("rejects garbage without throwing", () => {
    expect(parsePerformanceSnapshotJson({ schemaVersion: 2 })).toBeNull();
    expect(parsePerformanceSnapshotJson("not an object")).toBeNull();
    expect(parsePerformanceSnapshotFileContents("{ not json")).toBeNull();
    expect(parsePerformanceSnapshotFileContents("")).toBeNull();
  });

  it("parses valid JSON file contents", () => {
    const parsed = parsePerformanceSnapshotFileContents(JSON.stringify(validSnapshot));
    expect(parsed?.source).toBe("control-centre get_plan_vs_actual");
    expect(parsed?.channels).toHaveLength(1);
  });
});
