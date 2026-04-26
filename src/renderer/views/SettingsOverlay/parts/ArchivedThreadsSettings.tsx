import { Button, Surface, Tooltip } from "@heroui/react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useAppStore } from "@/renderer/state/appStore";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";

export function ArchivedThreadsSettings() {
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const unarchiveThread = useAppStore((s) => s.unarchiveThread);
  const deleteThread = useAppStore((s) => s.deleteThread);
  const archivedThreads = threads.filter((t) => t.archived);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-6 pb-8 pt-4">
      <div className="mx-auto max-w-[720px]">
        <h1 className="mb-6 text-lg font-semibold text-foreground">Archived Threads</h1>

        {archivedThreads.length === 0 ? (
          <p className="text-sm text-muted">No archived threads.</p>
        ) : (
          <Surface variant="secondary" className="divide-y divide-white/6 rounded-xl">
            {archivedThreads.map((thread) => {
              const project = projects.find((p) => p.id === thread.projectId);
              return (
                <div key={thread.id} className="flex items-center gap-3 px-4 py-3">
                  <ProviderIcon kind={thread.agentKind} className="size-4 shrink-0 text-muted" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm font-medium text-foreground">{thread.title}</p>
                    {project && <p className="truncate text-xs text-muted">{project.name}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Tooltip delay={150}>
                      <Tooltip.Trigger>
                        <Button
                          variant="ghost"
                          size="sm"
                          isIconOnly
                          aria-label="Restore thread"
                          onPress={() => unarchiveThread(thread.id)}
                        >
                          <ArchiveRestore className="size-4" />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>Restore thread</Tooltip.Content>
                    </Tooltip>
                    <Tooltip delay={150}>
                      <Tooltip.Trigger>
                        <Button
                          variant="ghost"
                          size="sm"
                          isIconOnly
                          aria-label="Delete thread"
                          onPress={() => deleteThread(thread.id)}
                        >
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>Delete permanently</Tooltip.Content>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </Surface>
        )}
      </div>
    </div>
  );
}
