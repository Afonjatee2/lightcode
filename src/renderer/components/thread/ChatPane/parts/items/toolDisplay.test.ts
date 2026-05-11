import { describe, expect, it } from "vitest";
import { Eye, Pencil, SearchCode } from "lucide-react";
import type { ToolCallPayload } from "@/shared/contracts";
import { deriveToolDisplay, isSubAgentTool } from "./toolDisplay";

function makePayload(payload: Partial<ToolCallPayload>): ToolCallPayload {
  return {
    name: "tool",
    status: "success",
    ...payload,
  } as ToolCallPayload;
}

describe("deriveToolDisplay", () => {
  it("labels ACP read tools from kind plus a path-like title", () => {
    const display = deriveToolDisplay(
      makePayload({
        name: "src/renderer/components/thread/ChatPane/parts/items/UserMessage.tsx",
        title: "src/renderer/components/thread/ChatPane/parts/items/UserMessage.tsx",
        kind: "read",
      }),
    );

    expect(display.title).toBe(
      "Read: src/renderer/components/thread/ChatPane/parts/items/UserMessage.tsx",
    );
    expect(display.parts).toEqual({
      prefix: "Read: ",
      path: "src/renderer/components/thread/ChatPane/parts/items/UserMessage.tsx",
      filePath: true,
    });
    expect(display.Icon).toBe(Eye);
  });

  it("labels ACP edit tools from a Gemini symbol-edit title", () => {
    const display = deriveToolDisplay(
      makePayload({
        name: "src/renderer/notifications.ts: function showToast => function showToast",
        title: "src/renderer/notifications.ts: function showToast => function showToast",
        kind: "edit",
      }),
    );

    expect(display.title).toBe("Edit: src/renderer/notifications.ts");
    expect(display.parts).toEqual({
      prefix: "Edit: ",
      path: "src/renderer/notifications.ts",
      filePath: true,
    });
    expect(display.Icon).toBe(Pencil);
  });

  it("labels ACP local search tools with the query and scope", () => {
    const display = deriveToolDisplay(
      makePayload({
        name: "'attachment' in src/renderer/**",
        title: "'attachment' in src/renderer/**",
        kind: "search",
        args: { query: "attachment", path: "src/renderer/**" },
      }),
    );

    expect(display.title).toBe('Search: "attachment" in src/renderer/**');
    expect(display.parts).toEqual({
      prefix: 'Search: "attachment" in ',
      path: "src/renderer/**",
    });
    expect(display.Icon).toBe(SearchCode);
  });

  it("keeps Claude raw tool displays intact", () => {
    const display = deriveToolDisplay(
      makePayload({
        name: "Read",
        args: { file_path: "src/foo.ts" },
      }),
    );

    expect(display.title).toBe("Read: src/foo.ts");
    expect(display.parts).toEqual({ prefix: "Read: ", path: "src/foo.ts", filePath: true });
    expect(display.Icon).toBe(Eye);
  });

  it("recognizes Copilot-style subagent payloads", () => {
    const payload = makePayload({
      name: "Critiquing path fixes",
      title: "Critiquing path fixes",
      isSubAgent: true,
      args: {
        description: "Critiquing path fixes",
        agent_type: "rubber-duck",
        name: "path-fix-duck",
        prompt: "We need to get a clean green run.",
      },
    });

    expect(isSubAgentTool(payload)).toBe(true);
    expect(deriveToolDisplay(payload).title).toBe("Agent (rubber-duck): Critiquing path fixes");
  });
});
