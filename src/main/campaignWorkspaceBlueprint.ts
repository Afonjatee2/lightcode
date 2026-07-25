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

const AGENTS_INSTRUCTIONS = `# Campaign workspace — agent notes

After fetching campaign performance data in chat, write or update \`.cockpit/performance-snapshot.json\` so the sidebar shows the latest numbers.

Schema (all numerics optional — include what you have):

\`\`\`json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-25T12:54:00.000Z",
  "source": "control-centre get_plan_vs_actual",
  "headline": "July pacing on track",
  "channels": [
    { "channel": "Meta", "spend": 12000, "budget": 15000, "impressions": 450000, "impressionsTarget": 500000, "status": "on_track" }
  ],
  "kpis": [{ "label": "CPA", "actual": 42, "target": 50, "pctAchieved": 84, "status": "on_track" }]
}
\`\`\`

Channel \`status\`: \`on_track\` | \`at_risk\` | \`no_data\`.
`;

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
  writeIfMissing(join(workspacePath, "AGENTS.md"), AGENTS_INSTRUCTIONS);

  const cockpitDir = join(workspacePath, ".cockpit");
  if (!existsSync(cockpitDir)) {
    mkdirSync(cockpitDir, { recursive: true });
  }

  const scriptsDir = join(workspacePath, "scripts");
  if (!existsSync(scriptsDir)) {
    mkdirSync(scriptsDir, { recursive: true });
  }
  writeIfMissing(join(scriptsDir, "README.md"), SCRIPTS_README);
}
