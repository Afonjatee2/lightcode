import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CampaignWorkspaceBlueprintContext {
  /** Workspace display name (folder label component). */
  name?: string | undefined;
  clientName?: string | undefined;
  campaignName?: string | undefined;
  jobNumber?: string | undefined;
}

function writeIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) return;
  writeFileSync(filePath, content, "utf8");
}

function formatReadmeHeader(context: CampaignWorkspaceBlueprintContext): string {
  const title = context.campaignName?.trim() || context.name?.trim() || "Campaign workspace";
  const client = context.clientName?.trim() || "—";
  const jobNumber = context.jobNumber?.trim() || "—";

  return `# ${title}

**Client:** ${client}
**Job number:** ${jobNumber}

## Goals / Targets

## Channels

## Key dates

`;
}

const PROJECT_DOCUMENTATION = `# Project documentation

## Platform mapping

## Data sources

## Scripts

`;

const ENV_EXAMPLE = `# Local-only secrets for campaign automation scripts.
# Copy to .env and fill in values. Never commit .env — it is not synced.

# META_ACCESS_TOKEN=
# GOOGLE_ADS_DEVELOPER_TOKEN=
# TIKTOK_ACCESS_TOKEN=
# SNAP_ACCESS_TOKEN=
# GA4_PROPERTY_ID=
`;

const SCRIPTS_README = "Campaign automation scripts — agents can run these from chat.\n";

/**
 * Idempotently scaffolds campaign workspace documentation and script folders.
 * Existing files are never overwritten.
 */
export function scaffoldCampaignWorkspaceBlueprint(
  workspacePath: string,
  context: CampaignWorkspaceBlueprintContext,
): void {
  writeIfMissing(join(workspacePath, "README.md"), formatReadmeHeader(context));
  writeIfMissing(join(workspacePath, "PROJECT_DOCUMENTATION.md"), PROJECT_DOCUMENTATION);
  writeIfMissing(join(workspacePath, ".env.example"), ENV_EXAMPLE);

  const scriptsDir = join(workspacePath, "scripts");
  if (!existsSync(scriptsDir)) {
    mkdirSync(scriptsDir, { recursive: true });
  }
  writeIfMissing(join(scriptsDir, "README.md"), SCRIPTS_README);
}
