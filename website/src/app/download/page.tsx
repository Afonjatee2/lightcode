import { getLatestRelease } from "@/lib/releases";
import { DownloadContent } from "./download-content";

export default async function DownloadPage() {
  const release = await getLatestRelease();
  return <DownloadContent release={release} />;
}
