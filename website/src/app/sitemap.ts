import type { MetadataRoute } from "next";

import { LOCALE_CODES } from "@/lib/i18n/config";
import { absoluteUrl, buildLanguageAlternates, localizedPath, SITEMAP_ROUTES } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  // Translated routes carry their full hreflang cluster; English-only routes
  // appear once without language alternatives.
  return SITEMAP_ROUTES.flatMap<MetadataRoute.Sitemap[number]>((route) => {
    if (!route.localized) {
      return [
        {
          url: absoluteUrl(route.path),
          changeFrequency: route.changeFrequency,
          priority: route.priority,
        },
      ];
    }

    const languages = buildLanguageAlternates(route.path);
    return LOCALE_CODES.map((locale) => ({
      url: absoluteUrl(localizedPath(route.path, locale)),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: { languages },
    }));
  });
}
