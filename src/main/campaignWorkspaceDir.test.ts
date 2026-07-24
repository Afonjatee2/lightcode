import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureCampaignWorkspaceDir, sanitizeWorkspaceName } from "@/main/campaignWorkspaceDir";

describe("sanitizeWorkspaceName", () => {
  it("returns identity for safe names", () => {
    expect(sanitizeWorkspaceName("test")).toBe("test");
    expect(sanitizeWorkspaceName("my-campaign")).toBe("my-campaign");
  });

  it("replaces path separators and special chars with hyphens", () => {
    expect(sanitizeWorkspaceName("a/b:c*d")).toBe("a-b-c-d");
    expect(sanitizeWorkspaceName("test?<name>|")).toBe("test-name");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeWorkspaceName("a--b")).toBe("a-b");
    expect(sanitizeWorkspaceName("a///b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeWorkspaceName("--test--")).toBe("test");
  });

  it("prevents path traversal", () => {
    const name = sanitizeWorkspaceName("../../../etc/passwd");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("returns default when result is empty", () => {
    expect(sanitizeWorkspaceName("")).toBe("workspace");
    expect(sanitizeWorkspaceName("///")).toBe("workspace");
  });
});

const VALID_UUID = "00000000-0000-4000-a000-000000000001";
const VALID_UUID_2 = "00000000-0000-4000-a000-000000000002";

describe("ensureCampaignWorkspaceDir", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "lc-camp-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("creates the managed directory under campaign-workspaces", () => {
    const result = ensureCampaignWorkspaceDir(baseDir, {
      projectId: VALID_UUID,
      name: "test-project",
    });

    expect(existsSync(result.path)).toBe(true);
    expect(result.location.kind).toBe("posix");
    expect((result.location as { kind: "posix"; path: string }).path).toBe(result.path);
  });

  it("reuses existing directory without error", () => {
    const first = ensureCampaignWorkspaceDir(baseDir, {
      projectId: VALID_UUID_2,
    });

    const second = ensureCampaignWorkspaceDir(baseDir, {
      projectId: VALID_UUID_2,
    });

    expect(second.path).toBe(first.path);
  });

  it("ensures parent directories exist", () => {
    const result = ensureCampaignWorkspaceDir(baseDir, {
      projectId: "00000000-0000-4000-a000-000000000003",
    });

    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(join(baseDir, "campaign-workspaces"))).toBe(true);
  });

  it("returns posix ProjectLocation on macOS", () => {
    const result = ensureCampaignWorkspaceDir(baseDir, {
      projectId: "00000000-0000-4000-a000-000000000004",
    });

    expect(result.location.kind).toBe("posix");
    expect((result.location as { kind: "posix"; path: string }).path).toBeTypeOf("string");
  });

  it("rejects non-UUID projectId", () => {
    expect(() =>
      ensureCampaignWorkspaceDir(baseDir, {
        projectId: "../../../etc/passwd",
      }),
    ).toThrow(/Invalid projectId/);
  });

  it("rejects short projectId", () => {
    expect(() =>
      ensureCampaignWorkspaceDir(baseDir, {
        projectId: "abc-123",
      }),
    ).toThrow(/Invalid projectId/);
  });
});
