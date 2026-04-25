import { useAppStore } from "@/renderer/state/appStore";
import { useProject } from "@/renderer/state/useThread";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { DEFAULT_SEARCH_EXCLUDE } from "@/shared/searchExclude";
import { SearchExcludeBody } from "@/renderer/views/SettingsOverlay/parts/SearchExcludeBody";

export function SearchSection(props: { projectId: string }) {
  const project = useProject(props.projectId);
  const updateProjectSearchSettings = useAppStore((s) => s.updateProjectSearchSettings);
  const globalUseIgnoreFiles = useSharedSettings((s) => s.searchUseIgnoreFiles);
  const globalExclude = useSharedSettings((s) => s.searchExclude);

  if (!project) return null;

  const settings = project.searchSettings ?? {};
  const projectExclude = settings.exclude ?? {};
  const overridesIgnoreFiles = settings.useIgnoreFiles !== undefined;
  const effectiveUseIgnoreFiles = settings.useIgnoreFiles ?? globalUseIgnoreFiles;

  const baseline: Record<string, boolean> = { ...DEFAULT_SEARCH_EXCLUDE, ...globalExclude };

  function update(next: typeof settings) {
    const empty =
      next.useIgnoreFiles === undefined &&
      (!next.exclude || Object.keys(next.exclude).length === 0);
    updateProjectSearchSettings(project!.id, empty ? undefined : next);
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-2 text-lg font-semibold text-foreground">Search</h1>
        <p className="mb-6 text-xs text-muted">
          Project-specific overrides on top of the global search settings.
        </p>

        <SearchExcludeBody
          useIgnoreFiles={effectiveUseIgnoreFiles}
          useIgnoreFilesNote={
            overridesIgnoreFiles
              ? "Overriding the global setting for this project."
              : `Inheriting the global setting (currently ${globalUseIgnoreFiles ? "on" : "off"}).`
          }
          onUseIgnoreFilesChange={(value) => update({ ...settings, useIgnoreFiles: value })}
          useIgnoreFilesResetAction={
            overridesIgnoreFiles ? (
              <button
                type="button"
                className="text-xs text-muted underline-offset-2 hover:underline"
                onClick={() => update({ ...settings, useIgnoreFiles: undefined })}
              >
                reset
              </button>
            ) : undefined
          }
          baseline={baseline}
          value={projectExclude}
          onValueChange={(next) => update({ ...settings, exclude: next })}
        />
      </div>
    </div>
  );
}
