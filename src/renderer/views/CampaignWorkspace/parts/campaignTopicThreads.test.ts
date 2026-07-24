import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import type { ConsultationRecord } from "@/shared/consultations";
import { campaignTopicGroupId, parseCampaignTopicIdFromGroupId } from "./campaignTopics";
import {
  findLegacyCampaignGuiThread,
  findThreadForCampaignTopic,
  getCampaignTopicActivityAt,
  indexCampaignTopicThreads,
  isCampaignTopicUnread,
  resolveCampaignTopicThread,
} from "./campaignTopicThreads";

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

function makeConsultation(
  overrides: Partial<ConsultationRecord> & Pick<ConsultationRecord, "parentThreadId">,
): ConsultationRecord {
  return {
    id: "consult-1",
    parentProjectId: "project-1",
    campaignGroupId: "group-1",
    childThreadOrRunId: null,
    originalMention: "@codex",
    originalInstruction: "check pacing",
    resolvedRole: "daily_operator",
    requestedProvider: "codex",
    actualProvider: "codex",
    requestedModel: null,
    actualModel: null,
    consultationMode: "standard",
    status: "completed",
    contextPacketId: null,
    permissionPolicyVersion: "v1",
    actor: "user",
    createdAt: "2026-07-02T10:00:00.000Z",
    startedAt: "2026-07-02T10:00:01.000Z",
    completedAt: "2026-07-02T10:05:00.000Z",
    cancelledAt: null,
    failureCode: null,
    safeFailureMessage: null,
    resultSummaryId: null,
    retryOfConsultationId: null,
    ...overrides,
  };
}

describe("campaign topic group ids", () => {
  it("round-trips topic ids through groupId", () => {
    expect(parseCampaignTopicIdFromGroupId(campaignTopicGroupId("pacing"))).toBe("pacing");
    expect(parseCampaignTopicIdFromGroupId("experiment-1")).toBeNull();
  });
});

describe("resolveCampaignTopicThread", () => {
  it("finds a tagged topic thread", () => {
    const pacing = makeThread({
      id: "pacing-thread",
      groupId: campaignTopicGroupId("pacing"),
      title: "Pacing",
    });
    expect(resolveCampaignTopicThread([pacing], "pacing")?.id).toBe("pacing-thread");
  });

  it("adopts the legacy GUI thread for monitoring when untagged", () => {
    const legacy = makeThread({ id: "legacy", createdAt: "2026-06-01T00:00:00.000Z" });
    const pacing = makeThread({
      id: "pacing-thread",
      groupId: campaignTopicGroupId("pacing"),
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    expect(resolveCampaignTopicThread([legacy, pacing], "monitoring")?.id).toBe("legacy");
    expect(resolveCampaignTopicThread([legacy, pacing], "pacing")?.id).toBe("pacing-thread");
  });

  it("returns undefined for non-monitoring topics without a backing thread", () => {
    const legacy = makeThread({ id: "legacy" });
    expect(resolveCampaignTopicThread([legacy], "client_update")).toBeUndefined();
  });
});

describe("indexCampaignTopicThreads", () => {
  it("indexes tagged threads and legacy monitoring", () => {
    const legacy = makeThread({ id: "legacy" });
    const pacing = makeThread({
      id: "pacing-thread",
      groupId: campaignTopicGroupId("pacing"),
    });
    const indexed = indexCampaignTopicThreads([legacy, pacing]);
    expect(indexed.monitoring?.id).toBe("legacy");
    expect(indexed.pacing?.id).toBe("pacing-thread");
  });
});

describe("findLegacyCampaignGuiThread", () => {
  it("ignores threads already tagged as campaign topics", () => {
    const tagged = makeThread({ groupId: campaignTopicGroupId("monitoring") });
    expect(findLegacyCampaignGuiThread([tagged])).toBeUndefined();
  });
});

describe("findThreadForCampaignTopic", () => {
  it("matches by group id", () => {
    const thread = makeThread({ groupId: campaignTopicGroupId("general") });
    expect(findThreadForCampaignTopic([thread], "general")?.id).toBe("thread-1");
  });
});

describe("isCampaignTopicUnread", () => {
  it("is unread when consultation activity is newer than the last view", () => {
    const thread = makeThread({
      id: "thread-a",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const records = [
      makeConsultation({
        parentThreadId: "thread-a",
        completedAt: "2026-07-03T12:00:00.000Z",
      }),
    ];
    expect(
      isCampaignTopicUnread({
        thread,
        isActive: false,
        lastViewedAtMs: new Date("2026-07-03T10:00:00.000Z").getTime(),
        consultationRecords: records,
      }),
    ).toBe(true);
  });

  it("is not unread for the active tab or untouched threads", () => {
    const thread = makeThread({ id: "thread-a" });
    expect(
      isCampaignTopicUnread({
        thread,
        isActive: true,
        lastViewedAtMs: 0,
        consultationRecords: [],
      }),
    ).toBe(false);
    expect(
      isCampaignTopicUnread({
        thread,
        isActive: false,
        lastViewedAtMs: 0,
        consultationRecords: [],
      }),
    ).toBe(false);
  });
});

describe("getCampaignTopicActivityAt", () => {
  it("uses the latest consultation completion timestamp", () => {
    const thread = makeThread({ id: "thread-a", updatedAt: "2026-07-01T00:00:00.000Z" });
    const activityAt = getCampaignTopicActivityAt(thread, [
      makeConsultation({
        parentThreadId: "thread-a",
        completedAt: "2026-07-04T08:00:00.000Z",
      }),
    ]);
    expect(activityAt).toBe(new Date("2026-07-04T08:00:00.000Z").getTime());
  });
});
