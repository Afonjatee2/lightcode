import type { Metadata } from "next";

import { LANDING_FAQ_ITEMS } from "@/lib/landingFaq";
import type { ReleaseInfo } from "@/lib/releases";
import { DEFAULT_LOCALE } from "./i18n/config";
import { translate } from "./i18n/messages";

export const SITE_NAME = "Lightcode";
export const SITE_URL = "https://lightcodeapp.com";
export const GITHUB_URL = "https://github.com/SDSLeon/lightcode";
export const SOCIAL_IMAGE_PATH = "/hero-screenshot.png";
export const SOCIAL_IMAGE_ALT =
  "Lightcode desktop app showing AI coding agents running side by side";

export const SITE_TITLE = "Lightcode - AI Coding Agent Desktop for Claude Code, Codex & Gemini";
export const SITE_DESCRIPTION =
  "Lightcode is an open-source desktop app for running Claude Code, Codex, Gemini, Cursor, OpenCode, and ACP agents side by side with terminals, diffs, browser previews, worktrees, and PRs.";

export const SEO_KEYWORDS = [
  "Lightcode",
  "AI coding agents",
  "Claude Code desktop app",
  "Codex desktop app",
  "Gemini coding agent",
  "Cursor agent",
  "OpenCode",
  "ACP Registry",
  "AI agent orchestrator",
  "developer tools",
];

export const SITEMAP_ROUTES = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/download", changeFrequency: "daily", priority: 0.9 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.7 },
  { path: "/nightly", changeFrequency: "daily", priority: 0.5 },
] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = absoluteUrl(path);

  return {
    title: {
      absolute: title,
    },
    description,
    keywords: SEO_KEYWORDS,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "en_US",
      type: "website",
      images: [
        {
          url: SOCIAL_IMAGE_PATH,
          width: 1973,
          height: 1276,
          alt: SOCIAL_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SOCIAL_IMAGE_PATH],
    },
  };
}

export function createHomeJsonLd(release: ReleaseInfo) {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icon.png"),
      width: 358,
      height: 358,
    },
    sameAs: [GITHUB_URL],
  };

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    alternateName: ["Lightcode Desktop", "Lightcode AI Agent Orchestrator"],
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "AI coding assistant workspace",
    operatingSystem: "macOS, Windows, Linux",
    url: SITE_URL,
    downloadUrl: absoluteUrl("/download"),
    image: absoluteUrl(SOCIAL_IMAGE_PATH),
    description: SITE_DESCRIPTION,
    codeRepository: GITHUB_URL,
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    releaseNotes: absoluteUrl("/changelog"),
    sameAs: [GITHUB_URL],
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    isAccessibleForFree: true,
    author: {
      "@id": `${SITE_URL}/#organization`,
    },
    publisher: {
      "@id": `${SITE_URL}/#organization`,
    },
    featureList: [
      "Run Claude Code, Codex, Gemini, Cursor, OpenCode, and ACP agents",
      "Use terminal-native and structured chat workflows side by side",
      "Keep browser previews, Git diffs, branches, worktrees, and PRs in one workspace",
      "Resume persistent AI coding sessions across macOS, Windows, and Linux",
    ],
    potentialAction: {
      "@type": "DownloadAction",
      target: absoluteUrl("/download"),
    },
    ...(release.version ? { softwareVersion: release.version } : {}),
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: {
      "@id": `${SITE_URL}/#organization`,
    },
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: LANDING_FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: translate(DEFAULT_LOCALE, item.questionKey),
      acceptedAnswer: {
        "@type": "Answer",
        text: translate(DEFAULT_LOCALE, item.answerKey),
      },
    })),
  };

  return [organization, website, softwareApplication, faqPage];
}

export function stringifyJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
