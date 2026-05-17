import type { AgentStatus, ProjectLocation } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { generateTitleWithFallback } from "@/renderer/components/providers";
import { useAppStore, makeThreadTitle } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export function generateTitleAsync(
  threadId: string,
  projectLocation: ProjectLocation,
  agentStatuses: readonly AgentStatus[],
  prompt: string,
): void {
  const settings = useSharedSettings.getState();
  const isWsl = projectLocation.kind === "wsl";
  const provider = isWsl ? settings.wslTitleGenProvider : settings.titleGenProvider;
  if (provider === "disabled") return;

  const model = isWsl ? settings.wslTitleGenModel : settings.titleGenModel;
  const effort = isWsl ? settings.wslTitleGenEffort : settings.titleGenEffort;

  void generateTitleWithFallback({
    projectLocation,
    agentStatuses,
    provider,
    model,
    effort,
    prompt,
    invoke: (payload) => {
      return readBridge().generateTitle(payload);
    },
  })
    .then((title) => {
      const store = useAppStore.getState();
      const thread = store.threads.find((t) => t.id === threadId);
      if (thread && thread.title === makeThreadTitle(prompt)) {
        store.renameThread(threadId, title);
      }
    })
    .catch((err) => {
      console.warn("[title-gen] failed, keeping fallback title:", err);
    });
}
