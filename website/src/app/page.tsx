import type { Metadata } from "next";

import { getLatestRelease } from "@/lib/releases";
import {
  createHomeJsonLd,
  createPageMetadata,
  SITE_DESCRIPTION,
  SITE_TITLE,
  stringifyJsonLd,
} from "@/lib/seo";
import { HomeContent } from "./home-content";

export const metadata: Metadata = createPageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default async function Home() {
  const release = await getLatestRelease();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(createHomeJsonLd(release)) }}
      />
      <HomeContent release={release} />
    </>
  );
}
