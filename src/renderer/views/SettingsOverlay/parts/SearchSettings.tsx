import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { DEFAULT_SEARCH_EXCLUDE } from "@/shared/searchExclude";
import { SearchExcludeBody } from "./SearchExcludeBody";

export function SearchSettings() {
  const useIgnoreFiles = useSharedSettings((s) => s.searchUseIgnoreFiles);
  const setUseIgnoreFiles = useSharedSettings((s) => s.setSearchUseIgnoreFiles);
  const exclude = useSharedSettings((s) => s.searchExclude);
  const setExclude = useSharedSettings((s) => s.setSearchExclude);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-2 text-lg font-semibold text-foreground">Search</h1>
        <p className="mb-6 text-xs text-muted">
          Control which files appear in the @file mention search. Per-project overrides live in each
          project's settings.
        </p>

        <SearchExcludeBody
          useIgnoreFiles={useIgnoreFiles}
          useIgnoreFilesNote={
            <>
              When enabled, search respects <code>.gitignore</code> entries.
            </>
          }
          onUseIgnoreFilesChange={setUseIgnoreFiles}
          baseline={DEFAULT_SEARCH_EXCLUDE}
          value={exclude}
          onValueChange={setExclude}
        />
      </div>
    </div>
  );
}
