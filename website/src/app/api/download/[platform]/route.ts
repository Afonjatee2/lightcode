import { NextResponse, type NextRequest } from "next/server";

const GITHUB_REPO = "SDSLeon/lightcode";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map platform slugs to filename match patterns.
 * The API route resolves the latest GitHub release and finds the matching asset.
 */
const PLATFORM_PATTERNS: Record<string, RegExp> = {
  "mac-arm64": /Lightcode-.*-arm64\.dmg$/,
  "mac-x64": /Lightcode-.*-x64\.dmg$/,
  "win-x64": /Lightcode-Setup-.*-x64\.exe$/,
  "win-arm64": /Lightcode-Setup-.*-arm64\.exe$/,
  "linux-x64": /Lightcode-.*-x64\.AppImage$/,
};

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubAsset[];
}

let cachedRelease: GitHubRelease | null = null;
let cachedAt = 0;

async function getLatestRelease(): Promise<GitHubRelease> {
  const now = Date.now();
  if (cachedRelease && now - cachedAt < CACHE_TTL_MS) {
    return cachedRelease;
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Lightcode-Website",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }

  const release = (await res.json()) as GitHubRelease;
  cachedRelease = release;
  cachedAt = now;
  return release;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const pattern = PLATFORM_PATTERNS[platform];

  if (!pattern) {
    return NextResponse.json(
      {
        error: "Unknown platform",
        valid: Object.keys(PLATFORM_PATTERNS),
      },
      { status: 400 },
    );
  }

  try {
    const release = await getLatestRelease();
    const asset = release.assets.find((a) => pattern.test(a.name));

    if (!asset) {
      // No matching asset — fall back to the release page
      return NextResponse.redirect(release.html_url, 302);
    }

    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch {
    // API failure — fall back to the releases page
    return NextResponse.redirect(`https://github.com/${GITHUB_REPO}/releases/latest`, 302);
  }
}
