import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { deriveLocationFromPath } from "@/shared/createProject";

/**
 * Sanitizes a string for use as a directory name: replaces path separators and
 * other dangerous characters with hyphens, collapses repeats, and trims.
 * Never allows traversal above the parent.
 */
export function sanitizeWorkspaceName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128) || "workspace";
}

export interface EnsureCampaignWorkspaceDirPayload {
  /** The project id (UUID) — used as the directory name for stable re-opening. */
  projectId: string;
  /** Sanitized name component for human readability (not used for path safety). */
  name?: string;
}

export interface EnsureCampaignWorkspaceDirResult {
  /** Absolute native path to the ensured workspace directory. */
  path: string;
  /** The ProjectLocation derived from the path. */
  location: ProjectLocation;
}

/**
 * Ensures the managed campaign workspace directory exists under
 * `<baseDir>/campaign-workspaces/<projectId>`. Creates it (and parents) if
 * missing. The directory name is the project id (a UUID), so path traversal
 * is impossible regardless of user input.
 *
 * Called from the main process only — never constructed in the renderer.
 */
export function ensureCampaignWorkspaceDir(
  baseDir: string,
  payload: { projectId: string; name?: string | undefined },
): EnsureCampaignWorkspaceDirResult {
  // Defense-in-depth: projectId must be a UUID to prevent path traversal
  // even if a compromised renderer sends a malicious value.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(payload.projectId)) {
    throw new Error(`Invalid projectId: expected UUID, got "${payload.projectId}"`);
  }

  const workspacesRoot = join(baseDir, "campaign-workspaces");
  const safeName = sanitizeWorkspaceName(payload.name ?? payload.projectId);
  const dirName = `${payload.projectId}${safeName ? `--${safeName}` : ""}`;
  const targetPath = join(workspacesRoot, dirName);

  mkdirSync(targetPath, { recursive: true });

  const location = deriveLocationFromPath(targetPath, process.platform);
  return { path: targetPath, location };
}
