import { readBridge } from "@/renderer/bridge";

export async function resolveCampaignAttachmentAbsolutePath(input: {
  projectId: string;
  relativePath: string;
}): Promise<string> {
  const normalized = input.relativePath.replace(/^\.\//, "");
  if (normalized.startsWith("/") || /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized;
  }
  const workspace = await readBridge().ensureCampaignWorkspaceDir({
    projectId: input.projectId,
  });
  const separator = workspace.path.endsWith("/") || workspace.path.endsWith("\\") ? "" : "/";
  return `${workspace.path}${separator}${normalized.replace(/\\/g, "/")}`;
}
