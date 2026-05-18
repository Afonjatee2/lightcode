import { describe, expect, it } from "vitest";
import { runtimeEventSchema } from "./runtimeEvent";

describe("runtimeEventSchema", () => {
  it("round-trips question_answer item events through JSON serialization", () => {
    const event = {
      type: "item.started",
      threadId: "t1",
      itemId: "qa-1",
      itemType: "question_answer",
      payload: {
        questions: [
          {
            header: "Access",
            question: "Allow this command?",
            selected: [{ label: "Allow once", description: "Only for this run" }],
            customAnswer: "Use README.md instead.",
          },
        ],
      },
    };

    expect(runtimeEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});
