const GITHUB_REPO = "SDSLeon/lightcode";
const RELEASES_LATEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

export const PLATFORM_PATTERNS: Record<string, RegExp> = {
  "mac-arm64": /Lightcode-.*-arm64\.dmg$/,
  "mac-x64": /Lightcode-.*-x64\.dmg$/,
  "win-x64": /Lightcode-Setup-.*-x64\.exe$/,
  "win-arm64": /Lightcode-Setup-.*-arm64\.exe$/,
  "linux-x64": /Lightcode-.*-x86_64\.AppImage$/,
};

export type PlatformSlug = keyof typeof PLATFORM_PATTERNS;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseResponse {
  tag_name: string;
  html_url: string;
  assets: GitHubAsset[];
}

export interface ReleaseInfo {
  version: string | null;
  releasesUrl: string;
  downloads: Partial<Record<string, string>>;
}

/**
 * Fetches the latest GitHub release. Server-only — relies on Next.js fetch
 * caching (`revalidate: 300`) so the version + asset URLs are refreshed every
 * 5 minutes without per-request hits to api.github.com.
 */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Lightcode-Website",
    };
    // Optional: required when the repo is private.
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers,
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const release = (await res.json()) as GitHubReleaseResponse;
    const downloads: Record<string, string> = {};
    for (const [slug, pattern] of Object.entries(PLATFORM_PATTERNS)) {
      const asset = release.assets.find((a) => pattern.test(a.name));
      if (asset) downloads[slug] = asset.browser_download_url;
    }

    return {
      version: release.tag_name.replace(/^v/, ""),
      releasesUrl: release.html_url,
      downloads,
    };
  } catch {
    return {
      version: null,
      releasesUrl: RELEASES_LATEST_URL,
      downloads: {},
    };
  }
}

export function downloadUrlFor(release: ReleaseInfo, slug: string): string {
  return release.downloads[slug] ?? release.releasesUrl;
}
