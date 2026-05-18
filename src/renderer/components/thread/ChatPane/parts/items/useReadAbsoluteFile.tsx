import { useEffect, useState } from "react";
import type { ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { resolveAbsolutePath as resolveAbsolutePathForLocation } from "@/renderer/utils/resolveAbsolutePath";

export interface FetchTarget {
  path: string;
  projectLocation: ProjectLocation;
}

export type ReadState =
  | "idle"
  | "loading"
  | "ready"
  | "missing"
  | "binary"
  | "too_large"
  | "unsupported"
  | "error";

export interface ReadResult {
  state: ReadState;
  content?: string;
  reason?: string;
}

export function useReadAbsoluteFile(target: FetchTarget | null): ReadResult {
  const [result, setResult] = useState<ReadResult>({ state: "idle" });
  const path = target?.path;
  const projectLocation = target?.projectLocation;

  useEffect(() => {
    if (!path || !projectLocation) {
      setResult({ state: "idle" });
      return;
    }
    let cancelled = false;
    setResult({ state: "loading" });
    const absolutePath = resolveAbsolutePath(path, projectLocation);
    readBridge()
      .readAbsoluteFile({ projectLocation, absolutePath })
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ready") {
          setResult({ state: "ready", content: res.content ?? "" });
        } else {
          setResult({ state: res.status });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({ state: "error", reason: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, projectLocation]);

  return result;
}

interface FileContentPlaceholderProps {
  state: ReadState;
  reason?: string | undefined;
}

export function FileContentPlaceholder({ state, reason }: FileContentPlaceholderProps) {
  const message =
    state === "loading" || state === "idle"
      ? "Loading file…"
      : state === "missing"
        ? "File no longer exists on disk."
        : state === "binary"
          ? "Binary file — preview unavailable."
          : state === "too_large"
            ? "File is too large to preview."
            : state === "unsupported"
              ? "File uses an unsupported encoding."
              : (reason ?? "Could not read file.");
  return <div className="font-mono text-[color:var(--muted)]/80 text-xs">{message}</div>;
}

function resolveAbsolutePath(rawPath: string, location: ProjectLocation): string {
  if (isAbsolutePath(rawPath)) return rawPath;
  return resolveAbsolutePathForLocation(location, rawPath.replace(/^[\\/]+/, ""));
}

function isAbsolutePath(p: string): boolean {
  if (p.startsWith("/")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\")) return true;
  return false;
}
