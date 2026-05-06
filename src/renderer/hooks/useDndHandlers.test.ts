import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { resolveThreadReorder } from "./useDndHandlers";

function makeThread(id: string, starred = false): Thread {
  return {
    id,
    projectId: "project-1",
    title: id,
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: false,
    archived: false,
    done: false,
    starred,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };
}

describe("resolveThreadReorder", () => {
  it("uses the hovered thread instead of the virtualized final index", () => {
    const threads = [makeThread("a"), makeThread("b", true), makeThread("c")];

    expect(
      resolveThreadReorder({
        threads,
        source: {
          type: "thread",
          threadId: "b",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 0,
        },
        target: {
          type: "thread",
          threadId: "c",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 2,
        },
        initialIndex: 0,
        finalIndex: 1,
      }),
    ).toEqual({ targetId: "c", placement: "after" });
  });

  it("falls back to the manual rendered order when no hovered thread is available", () => {
    const threads = [makeThread("a"), makeThread("b", true), makeThread("c")];

    expect(
      resolveThreadReorder({
        threads,
        source: {
          type: "thread",
          threadId: "b",
          projectId: "project-1",
          sortGroup: "project-entries:project-1",
          sortIndex: 0,
        },
        target: null,
        initialIndex: 0,
        finalIndex: 2,
      }),
    ).toEqual({ targetId: "c", placement: "after" });
  });
});
