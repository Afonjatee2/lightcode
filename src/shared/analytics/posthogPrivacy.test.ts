import { describe, expect, it } from "vitest";
import {
  bucketCount,
  bucketDurationMs,
  sanitizeProductAnalyticsEvent,
  sanitizeProductAnalyticsProperties,
} from "./posthogPrivacy";

describe("posthog product analytics privacy", () => {
  it("keeps only allowlisted product analytics properties", () => {
    expect(
      sanitizeProductAnalyticsProperties({
        provider: "codex",
        presentation: "gui",
        effort: "high",
        project_id: "secret",
        repo: "secret-repo",
        prompt: "do something",
        code: "const token = 1",
        branch: "feature/private",
      }),
    ).toEqual({
      provider: "codex",
      presentation: "gui",
      effort: "high",
    });
  });

  it("keeps allowlisted keys that include sensitive words", () => {
    expect(
      sanitizeProductAnalyticsProperties({
        auto_generated_message: true,
        file_segment_count: 2,
        has_remote: true,
        has_worktree: true,
        worktree_count_bucket: "2_3",
      }),
    ).toEqual({
      auto_generated_message: true,
      file_segment_count: 2,
      has_remote: true,
      has_worktree: true,
      worktree_count_bucket: "2_3",
    });
  });

  it("scrubs sensitive strings even for allowlisted keys", () => {
    expect(
      sanitizeProductAnalyticsProperties({
        source: "/Users/alice/private-repo/src/app.ts token=abc123",
        action: "Bearer abcdef",
      }),
    ).toEqual({
      source: "[path] token=[redacted]",
      action: "Bearer [redacted]",
    });
  });

  it("drops unknown properties regardless of key sensitivity", () => {
    expect(
      sanitizeProductAnalyticsProperties({
        custom_count: 1,
        repo: "secret-repo",
        worktree_path: "/Users/alice/repo",
      }),
    ).toEqual({});
  });

  it("keeps null values and drops undefined or empty strings", () => {
    expect(
      sanitizeProductAnalyticsProperties({
        action: "",
        outcome: null,
        provider: undefined,
      }),
    ).toEqual({
      outcome: null,
    });
  });

  it("accepts only known event names", () => {
    expect(sanitizeProductAnalyticsEvent("thread.started", { provider: "claude" })).toEqual({
      event: "thread.started",
      properties: { provider: "claude" },
    });
    expect(
      sanitizeProductAnalyticsEvent(
        "query.captured" as Parameters<typeof sanitizeProductAnalyticsEvent>[0],
        {},
      ),
    ).toBeNull();
  });

  it("buckets durations and counts", () => {
    expect(bucketDurationMs(500)).toBe("lt_10s");
    expect(bucketDurationMs(70_000)).toBe("1m_5m");
    expect(bucketDurationMs(3_700_000)).toBe("gte_1h");
    expect(bucketCount(0)).toBe("0");
    expect(bucketCount(3)).toBe("2_3");
    expect(bucketCount(20)).toBe("gt_10");
  });
});
