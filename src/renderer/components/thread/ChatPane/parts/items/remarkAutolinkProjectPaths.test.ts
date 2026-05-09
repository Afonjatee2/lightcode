import { describe, expect, it } from "vitest";
import type { ProjectPathRef } from "./parseProjectPathRef";
import {
  AUTO_PATH_FILE_PREFIX,
  remarkAutolinkProjectPaths,
} from "./remarkAutolinkProjectPaths";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

describe("remarkAutolinkProjectPaths", () => {
  it("rewrites recognized markdown link urls to file-chip links", () => {
    const tree: MdNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "C:/repo/src/supervisor/agents/acp/session.ts:945",
              children: [{ type: "text", value: "session.ts" }],
            },
          ],
        },
      ],
    };

    remarkAutolinkProjectPaths({
      parsePathRef: (token): ProjectPathRef | null =>
        token === "C:/repo/src/supervisor/agents/acp/session.ts:945"
          ? { kind: "file", path: "src/supervisor/agents/acp/session.ts", line: 945 }
          : null,
    })(tree);

    expect(tree.children?.[0]?.children?.[0]?.url).toBe(
      `${AUTO_PATH_FILE_PREFIX}src/supervisor/agents/acp/session.ts:945`,
    );
  });
});
