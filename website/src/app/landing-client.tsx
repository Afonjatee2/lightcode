"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Download } from "lucide-react";

import type { ReleaseInfo } from "@/lib/releases";

type Platform = { label: string; slug: string };

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }>;
  };
};

function detectAppleSiliconViaWebGL(): boolean | undefined {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return undefined;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return undefined;
    const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
    if (/Apple\s+(?:GPU|M\d)/i.test(renderer)) return true;
    if (/(?:Intel|AMD|Radeon|NVIDIA)/i.test(renderer)) return false;
    return undefined;
  } catch {
    return undefined;
  }
}

async function getBrowserArchitecture(): Promise<string | undefined> {
  try {
    const uaData = await (
      navigator as NavigatorWithUserAgentData
    ).userAgentData?.getHighEntropyValues(["architecture"]);
    return uaData?.architecture;
  } catch {
    return undefined;
  }
}

function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>({ label: "Desktop", slug: "mac-arm64" });

  useEffect(() => {
    let cancelled = false;
    const apply = (value: Platform) => {
      if (!cancelled) setPlatform(value);
    };
    const ua = navigator.userAgent;
    const detect = async () => {
      if (ua.includes("Mac")) {
        const architecture = await getBrowserArchitecture();
        const isArm = architecture
          ? /^(?:arm|arm64|aarch64)$/i.test(architecture)
          : (detectAppleSiliconViaWebGL() ?? true);
        apply(
          isArm
            ? { label: "macOS (arm)", slug: "mac-arm64" }
            : { label: "macOS (Intel)", slug: "mac-x64" },
        );
      } else if (ua.includes("Win")) {
        const architecture = await getBrowserArchitecture();
        const isArm = architecture
          ? /^(?:arm|arm64|aarch64)$/i.test(architecture)
          : ua.includes("ARM") || ua.includes("Aarch64");
        apply(
          isArm
            ? { label: "Windows (ARM)", slug: "win-arm64" }
            : { label: "Windows", slug: "win-x64" },
        );
      } else if (ua.includes("Linux")) {
        apply({ label: "Linux", slug: "linux-x64" });
      }
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  return platform;
}

export function PlatformDownloadLink({
  release,
  label,
  className,
  shortcut = false,
}: {
  release: ReleaseInfo;
  label: string;
  className: string;
  shortcut?: boolean;
}) {
  const platform = usePlatform();
  return (
    <a href={release.downloads[platform.slug] ?? release.releasesUrl} className={className}>
      <Download className="h-4 w-4" />
      {label.split("{platform}").join(platform.label)}
      {shortcut ? (
        <kbd className="ml-0.5 rounded bg-night/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-night/70">
          ⌘D
        </kbd>
      ) : null}
    </a>
  );
}

export function TiltFrame({ className, children }: { className: string; children: ReactNode }) {
  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rotateX = -((event.clientY - rect.top) / rect.height - 0.5) * 5;
    const rotateY = ((event.clientX - rect.left) / rect.width - 0.5) * 6;
    event.currentTarget.style.transform = `perspective(1600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const onLeave = (event: MouseEvent<HTMLDivElement>) => {
    event.currentTarget.style.removeProperty("transform");
  };

  return (
    <div onMouseMove={onMove} onMouseLeave={onLeave} className={className}>
      {children}
    </div>
  );
}
