import { describe, expect, it } from "vitest";
import { executorSpecAttachmentSchema, generateExecutorSpecPayloadSchema } from "./git";

const projectLocation = { kind: "posix" as const, path: "/repo" };

function basePayload() {
  return {
    projectLocation,
    agentKind: "codex" as const,
    task: "Fix the Overview page month selector",
  };
}

describe("executorSpecAttachmentSchema", () => {
  it("accepts a path with an optional mimeType", () => {
    expect(executorSpecAttachmentSchema.safeParse({ path: "/tmp/design.png" }).success).toBe(true);
    expect(
      executorSpecAttachmentSchema.safeParse({ path: "/tmp/design.png", mimeType: "image/png" })
        .success,
    ).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(executorSpecAttachmentSchema.safeParse({ path: "" }).success).toBe(false);
  });
});

describe("generateExecutorSpecPayloadSchema attachments", () => {
  it("accepts a valid attachments array", () => {
    const result = generateExecutorSpecPayloadSchema.safeParse({
      ...basePayload(),
      attachments: [
        { path: "/tmp/design.png", mimeType: "image/png" },
        { path: "/tmp/notes.md" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with no attachments", () => {
    expect(generateExecutorSpecPayloadSchema.safeParse(basePayload()).success).toBe(true);
  });

  it("rejects an attachments array longer than 10", () => {
    const result = generateExecutorSpecPayloadSchema.safeParse({
      ...basePayload(),
      attachments: Array.from({ length: 11 }, (_, index) => ({ path: `/tmp/file-${index}.png` })),
    });
    expect(result.success).toBe(false);
  });

  it("accepts attachments with an empty task", () => {
    const result = generateExecutorSpecPayloadSchema.safeParse({
      ...basePayload(),
      task: "",
      attachments: [{ path: "/tmp/design.png", mimeType: "image/png" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty task with no attachments", () => {
    const result = generateExecutorSpecPayloadSchema.safeParse({
      ...basePayload(),
      task: "   ",
    });
    expect(result.success).toBe(false);
  });
});
