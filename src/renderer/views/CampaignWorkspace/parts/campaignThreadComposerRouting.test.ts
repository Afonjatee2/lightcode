import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import {
  resolvePrimaryCampaignThread,
  routeCampaignComposerMessage,
} from "./campaignThreadComposerRouting";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Campaign thread",
    agentKind: "codex",
    config: { model: "gpt-5" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred: false,
    presentationMode: "gui",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePrimaryCampaignThread", () => {
  it("returns the oldest non-archived thread", () => {
    const older = makeThread({ id: "older", createdAt: "2026-07-01T00:00:00.000Z" });
    const newer = makeThread({ id: "newer", createdAt: "2026-07-02T00:00:00.000Z" });
    expect(resolvePrimaryCampaignThread([newer, older])?.id).toBe("older");
  });

  it("ignores archived threads", () => {
    const archived = makeThread({ id: "archived", archived: true });
    const active = makeThread({ id: "active", createdAt: "2026-07-03T00:00:00.000Z" });
    expect(resolvePrimaryCampaignThread([archived, active])?.id).toBe("active");
  });

  it("returns undefined when every thread is archived", () => {
    expect(resolvePrimaryCampaignThread([makeThread({ archived: true })])).toBeUndefined();
  });
});

describe("routeCampaignComposerMessage", () => {
  it("passes a provider mention through unchanged", () => {
    expect(routeCampaignComposerMessage("@codex verify spend", "claude")).toEqual({
      kind: "consultation",
      message: "@codex verify spend",
    });
  });

  it("passes a mode keyword mention through unchanged", () => {
    expect(routeCampaignComposerMessage("@verify check the KPI evidence", "claude")).toEqual({
      kind: "consultation",
      message: "@verify check the KPI evidence",
    });
  });

  it("wraps plain text with the default provider", () => {
    expect(routeCampaignComposerMessage("Summarise pacing", "codex")).toEqual({
      kind: "consultation",
      message: "@codex Summarise pacing",
    });
  });

  it("returns empty for blank input", () => {
    expect(routeCampaignComposerMessage("   ", "codex")).toEqual({ kind: "empty" });
  });

  it("rejects an unknown @mention instead of wrapping it", () => {
    const result = routeCampaignComposerMessage("@nosuchagent hello", "codex");
    expect(result.kind).toBe("parse_error");
  });

  it("returns a parse error when the mention is malformed", () => {
    const result = routeCampaignComposerMessage("@codex", "codex");
    expect(result).toMatchObject({
      kind: "parse_error",
      message: expect.stringContaining("@codex"),
    });
  });
});
