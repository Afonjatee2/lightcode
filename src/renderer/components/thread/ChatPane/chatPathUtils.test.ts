import { describe, expect, it } from "vitest";
import { normalizeChatProjectPath } from "./chatPathUtils";

describe("normalizeChatProjectPath", () => {
  it("normalizes Windows project-absolute paths to project-relative paths", () => {
    expect(
      normalizeChatProjectPath("C:/repo/src/supervisor/agents/acp/session.ts:945", {
        kind: "windows",
        path: "C:\\repo",
      }),
    ).toBe("src/supervisor/agents/acp/session.ts:945");
  });

  it("normalizes POSIX project-absolute paths to project-relative paths", () => {
    expect(
      normalizeChatProjectPath("/home/me/repo/src/supervisor/agents/acp/session.ts:945", {
        kind: "posix",
        path: "/home/me/repo",
      }),
    ).toBe("src/supervisor/agents/acp/session.ts:945");
  });

  it("normalizes POSIX file URIs to project-relative paths", () => {
    expect(
      normalizeChatProjectPath("file:///home/me/repo/src/supervisor/agents/acp/session.ts:945", {
        kind: "posix",
        path: "/home/me/repo",
      }),
    ).toBe("src/supervisor/agents/acp/session.ts:945");
  });

  it("normalizes WSL Linux paths to project-relative paths", () => {
    expect(
      normalizeChatProjectPath("/home/me/repo/src/supervisor/agents/acp/session.ts:945", {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/me/repo",
        uncPath: "\\\\wsl$\\Ubuntu\\home\\me\\repo",
      }),
    ).toBe("src/supervisor/agents/acp/session.ts:945");
  });

  it("normalizes WSL UNC paths to project-relative paths", () => {
    expect(
      normalizeChatProjectPath(
        "\\\\wsl$\\Ubuntu\\home\\me\\repo\\src\\supervisor\\agents\\acp\\session.ts:945",
        {
          kind: "wsl",
          distro: "Ubuntu",
          linuxPath: "/home/me/repo",
          uncPath: "\\\\wsl$\\Ubuntu\\home\\me\\repo",
        },
      ),
    ).toBe("src/supervisor/agents/acp/session.ts:945");
  });
});
