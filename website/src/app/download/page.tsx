import type { Metadata } from "next";

import { getLatestRelease } from "@/lib/releases";
import { createPageMetadata } from "@/lib/seo";
import { DownloadContent } from "./download-content";

export const metadata: Metadata = createPageMetadata({
  title: "Download Lightcode",
  description:
    "Download Lightcode for macOS, Windows, and Linux. Install the desktop workspace for Claude Code, Codex, Gemini, Cursor, OpenCode, and ACP agents.",
  path: "/download",
});

export default async function DownloadPage() {
  const release = await getLatestRelease();
  return <DownloadContent release={release} />;
}
