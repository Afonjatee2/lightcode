import { ModelOrderSection } from "./ModelOrderSection";
import { ModelVisibilitySection } from "./ModelVisibilitySection";

export function AgentsGeneralSettings() {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-6 text-lg font-semibold text-foreground">Agents · General</h1>

        <div className="space-y-4">
          <ModelVisibilitySection />
          <ModelOrderSection />
        </div>
      </div>
    </div>
  );
}
