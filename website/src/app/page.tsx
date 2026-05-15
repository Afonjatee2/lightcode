import { getLatestRelease } from "@/lib/releases";
import { HomeContent } from "./home-content";

export default async function Home() {
  const release = await getLatestRelease();
  return <HomeContent release={release} />;
}
