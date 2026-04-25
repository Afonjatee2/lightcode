import { useState } from "react";
import { useAppStore } from "@/renderer/state/appStore";
import { useProject } from "@/renderer/state/useThread";
import { Input } from "@/renderer/components/common";

export function GeneralSection(props: { projectId: string }) {
  const project = useProject(props.projectId);
  const renameProject = useAppStore((s) => s.renameProject);
  const [name, setName] = useState(project?.name ?? "");

  if (!project) return null;

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-6 text-lg font-semibold text-foreground">General</h1>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Project name</p>
              <p className="text-xs text-muted">Display name in the sidebar.</p>
            </div>
            <Input
              aria-label="Project name"
              className="w-[240px] shrink-0"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== project.name) {
                  renameProject(project.id, trimmed);
                } else {
                  setName(project.name);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
