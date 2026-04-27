import { startTransition, useEffect, useState } from "react";
import { FolderPlus, TerminalSquare } from "lucide-react";
import { Button } from "@heroui/react";
import type { ProjectLocation } from "@/shared/contracts";
import { isWindows, readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { autoDetectSetupScript } from "@/renderer/utils/gitHelpers";

export function WelcomeOverlay() {
  const projects = useAppStore((state) => state.projects);
  const addProject = useAppStore((state) => state.addProject);
  const openDraft = useAppStore((state) => state.openDraft);

  const open = projects.length === 0;
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [open]);

  function handleTransitionEnd(e: React.TransitionEvent) {
    if (e.target === e.currentTarget && !visible) {
      setMounted(false);
    }
  }

  function handleStart() {
    void readBridge()
      .pickFolder()
      .then((path) => {
        if (!path) return;
        startTransition(() => {
          const location: ProjectLocation = isWindows()
            ? { kind: "windows", path }
            : { kind: "posix", path };
          const project = addProject(location);
          autoDetectSetupScript(project);
          openDraft(project.id);
        });
      });
  }

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-background transition-opacity ${
        visible ? "opacity-100 duration-150" : "opacity-0 duration-500"
      }`}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        className="lightcode-overlay-header flex shrink-0 items-center px-2"
        style={{ height: "env(titlebar-area-height, 32px)" }}
      />

      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-8">
          <h1 className="flex items-baseline gap-3 overflow-visible pr-[0.22em] pb-[0.2em] text-[clamp(3.25rem,8vw,6.25rem)] leading-[1.28] font-semibold tracking-normal">
            <span className="inline-block pr-[0.04em] pb-[0.12em] text-transparent [background-image:linear-gradient(135deg,var(--foreground)_0%,color-mix(in_oklab,var(--accent)_60%,var(--foreground))_52%,var(--muted)_100%)] [background-size:100%_100%] bg-clip-text">
              Lightcode
            </span>
            <TerminalSquare className="translate-y-[-0.04em] size-[0.48em] shrink-0 text-[color:color-mix(in_oklab,var(--accent)_58%,var(--foreground))] opacity-90" />
          </h1>

          <p className="text-sm text-muted">Start your experience by adding your first project</p>

          <Button size="lg" variant="primary" onPress={handleStart}>
            <FolderPlus className="size-4" />
            Start
          </Button>
        </div>
      </div>
    </div>
  );
}
