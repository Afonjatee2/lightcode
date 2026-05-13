import { ArrowRight, FolderOpen, Plus, TerminalSquare } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/renderer/state/appStore";
import { openThread } from "@/renderer/actions/threadActions";
import { ProviderIcon, getStatusTone } from "@/renderer/components/providers";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";

export function HomeView() {
  const projects = useAppStore(useShallow((state) => state.projects));
  const recentThreads = useAppStore(
    useShallow((state) =>
      state.threads
        .filter((t) => !t.done)
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    ),
  );
  const openDraft = useAppStore((state) => state.openDraft);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 flex-col px-8 py-8">
        <div className="mx-auto flex h-full w-full max-w-[560px] flex-col">
          <div className="flex flex-1 flex-col justify-center">
            <h1 className="flex items-baseline gap-3 overflow-visible pr-[0.22em] pb-[0.2em] text-[clamp(3.25rem,8vw,6.25rem)] leading-[1.28] font-semibold tracking-normal">
              <span className="inline-block pr-[0.04em] pb-[0.12em] text-transparent [background-image:linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_60%,var(--foreground))_52%,var(--muted)_100%)] [background-size:100%_100%] bg-clip-text">
                Lightcode
              </span>
              <TerminalSquare className="translate-y-[-0.04em] size-[0.48em] shrink-0 text-[color:color-mix(in_oklab,var(--accent)_58%,var(--foreground))] opacity-90" />
            </h1>

            <div className="mt-10 flex w-full flex-col gap-8">
              {projects.length > 0 && (
                <section>
                  {projects.length === 0 ? (
                    <p className="text-sm text-muted">add a project to start</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {projects.map((project) => (
                        <button
                          key={project.id}
                          className="group flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                          onClick={() => openDraft(project.id)}
                          type="button"
                        >
                          <FolderOpen className="size-4 shrink-0 text-muted" />
                          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                            {project.name}
                          </p>
                          <Plus className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {recentThreads.length > 0 ? (
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Recent threads
                  </h2>
                  <div className="flex flex-col gap-1">
                    {recentThreads.map((thread) => {
                      const project = projects.find((p) => p.id === thread.projectId);
                      return (
                        <button
                          key={thread.id}
                          className="group flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                          onClick={() => openThread(thread.id)}
                          type="button"
                        >
                          <ProviderIcon
                            kind={thread.agentKind}
                            tone={getStatusTone(thread)}
                            className="size-4 shrink-0"
                          />
                          <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                            {thread.title}
                          </p>
                          {project ? (
                            <span className="ml-3 shrink-0 text-xs text-muted">{project.name}</span>
                          ) : null}
                          <RelativeTime
                            iso={thread.updatedAt}
                            className="ml-3 w-[3ch] shrink-0 text-right font-mono text-xs tabular-nums text-muted"
                          />
                          <ArrowRight className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
