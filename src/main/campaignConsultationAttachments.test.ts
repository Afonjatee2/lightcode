import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CAMPAIGN_ATTACHMENT_SUBDIR,
  CAMPAIGN_LARGE_ATTACHMENT_BYTES,
  copyCampaignConsultationAttachments,
} from "@/main/campaignConsultationAttachments";

const VALID_UUID = "00000000-0000-4000-a000-000000000001";

describe("copyCampaignConsultationAttachments", () => {
  let baseDir: string;
  let sourceDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "lc-camp-attach-"));
    sourceDir = mkdtempSync(join(tmpdir(), "lc-camp-src-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  it("copies files into the workspace attachments directory with relative paths", async () => {
    const sourcePath = join(sourceDir, "plan-v3.xlsx");
    writeFileSync(sourcePath, "spreadsheet");

    const result = await copyCampaignConsultationAttachments(baseDir, {
      projectId: VALID_UUID,
      sourcePaths: [sourcePath],
    });

    expect(result.copies).toHaveLength(1);
    expect(result.copies[0]).toMatchObject({
      relativePath: `./${CAMPAIGN_ATTACHMENT_SUBDIR}/plan-v3.xlsx`,
      fileName: "plan-v3.xlsx",
      largeFile: false,
    });
    const workspaceRoot = join(baseDir, "campaign-workspaces", `${VALID_UUID}--${VALID_UUID}`);
    expect(
      readFileSync(join(workspaceRoot, CAMPAIGN_ATTACHMENT_SUBDIR, "plan-v3.xlsx"), "utf8"),
    ).toBe("spreadsheet");
  });

  it("uses collision-safe names when a file already exists", async () => {
    const sourcePath = join(sourceDir, "brief.pdf");
    writeFileSync(sourcePath, "first");

    await copyCampaignConsultationAttachments(baseDir, {
      projectId: VALID_UUID,
      sourcePaths: [sourcePath],
    });

    const second = await copyCampaignConsultationAttachments(baseDir, {
      projectId: VALID_UUID,
      sourcePaths: [sourcePath],
    });

    expect(second.copies[0]?.fileName).toBe("brief (2).pdf");
    const workspaceRoot = join(baseDir, "campaign-workspaces", `${VALID_UUID}--${VALID_UUID}`);
    expect(existsSync(join(workspaceRoot, CAMPAIGN_ATTACHMENT_SUBDIR, "brief (2).pdf"))).toBe(true);
  });

  it("rejects a traversal-crafted projectId instead of escaping the base dir", async () => {
    const sourcePath = join(sourceDir, "innocent.txt");
    writeFileSync(sourcePath, "data");

    await expect(
      copyCampaignConsultationAttachments(baseDir, {
        projectId: "../../outside",
        sourcePaths: [sourcePath],
      }),
    ).rejects.toThrow("Invalid projectId");
    expect(existsSync(join(baseDir, "..", "outside"))).toBe(false);
  });

  it("confines copies to the attachments dir regardless of source location", async () => {
    const outsideDir = join(sourceDir, "..", "elsewhere");
    mkdirSync(outsideDir, { recursive: true });
    const sourcePath = join(outsideDir, "deep-file.bin");
    writeFileSync(sourcePath, "bytes");

    const result = await copyCampaignConsultationAttachments(baseDir, {
      projectId: VALID_UUID,
      sourcePaths: [sourcePath],
    });

    const workspaceRoot = join(baseDir, "campaign-workspaces", `${VALID_UUID}--${VALID_UUID}`);
    expect(result.copies[0]?.relativePath).toBe(`./${CAMPAIGN_ATTACHMENT_SUBDIR}/deep-file.bin`);
    expect(existsSync(join(workspaceRoot, CAMPAIGN_ATTACHMENT_SUBDIR, "deep-file.bin"))).toBe(true);
  });

  it("flags files larger than 100 MB", async () => {
    const sourcePath = join(sourceDir, "huge.zip");
    writeFileSync(sourcePath, Buffer.alloc(CAMPAIGN_LARGE_ATTACHMENT_BYTES + 1));

    const result = await copyCampaignConsultationAttachments(baseDir, {
      projectId: VALID_UUID,
      sourcePaths: [sourcePath],
    });

    expect(result.copies[0]?.largeFile).toBe(true);
  });
});
