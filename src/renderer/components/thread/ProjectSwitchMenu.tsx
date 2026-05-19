import { startTransition } from "react";
import { ChevronDown, FolderOpen, Monitor } from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useShallow } from "zustand/shallow";
import type { Project } from "@/shared/contracts";
import { makeDraftPaneId } from "@/shared/paneId";
import { useAppStore } from "@/renderer/state/appStore";
import { TuxIcon } from "@/renderer/components/common/TuxIcon";

function LocationIcon(props: { kind: Project["location"]["kind"] }) {
  if (props.kind === "wsl") {
    return <TuxIcon className="size-4 shrink-0 text-muted" />;
  }
  if (props.kind === "windows") {
    return <Monitor className="size-4 shrink-0 text-muted" />;
  }
  return <FolderOpen className="size-4 shrink-0 text-muted" />;
}

export function ProjectSwitchMenu(props: {
  currentProjectId: string;
  variant: "hero" | "compact";
  /** When provided, switching replaces this pane id instead of changing the top-level draft view. */
  paneId?: string;
}) {
  const { currentProjectId, variant, paneId } = props;
  const projects = useAppStore(useShallow((state) => state.projects.filter((p) => !p.disabled)));
  const openDraft = useAppStore((state) => state.openDraft);
  const replacePaneId = useAppStore((state) => state.replacePaneId);

  const current = projects.find((p) => p.id === currentProjectId);
  const label = current?.name ?? "Select project";
  const isDisabled = projects.length <= 1;

  function handleSelect(nextProjectId: string) {
    if (nextProjectId === currentProjectId) return;
    startTransition(() => {
      if (paneId) {
        replacePaneId(paneId, makeDraftPaneId(nextProjectId));
      } else {
        openDraft(nextProjectId);
      }
    });
  }

  const menu = (
    <Dropdown.Menu
      aria-label="Switch project"
      selectionMode="single"
      selectedKeys={[currentProjectId]}
      onAction={(key) => handleSelect(String(key))}
      className="lightcode-menu min-w-56"
    >
      {projects.map((project) => (
        <Dropdown.Item key={project.id} id={project.id} textValue={project.name}>
          <LocationIcon kind={project.location.kind} />
          <Label>{project.name}</Label>
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );

  if (variant === "hero") {
    return (
      <Dropdown>
        <Dropdown.Trigger
          aria-label="Switch project"
          isDisabled={isDisabled}
          className="group mx-auto inline-flex max-w-full items-center gap-1.5 rounded border border-transparent px-2 py-0.5 outline-none transition-colors hover:border-border/60 hover:bg-white/[0.03] focus-visible:border-border focus-visible:bg-white/[0.03] disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
        >
          <span className="min-w-0 truncate pb-[0.08em] leading-snug font-medium tracking-normal text-transparent [background-image:linear-gradient(135deg,var(--muted)_0%,color-mix(in_oklab,var(--accent)_30%,var(--muted))_100%)] [background-size:100%_100%] bg-clip-text font-mono">
            {label}
          </span>
          {!isDisabled ? (
            <ChevronDown className="size-3 shrink-0 text-muted/60 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          ) : null}
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom">{menu}</Dropdown.Popover>
      </Dropdown>
    );
  }

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="Switch project"
        isDisabled={isDisabled}
        className="group inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1 py-0.5 text-sm leading-tight text-muted/60 outline-none transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted/60"
      >
        <span className="min-w-0 truncate">{label}</span>
        {!isDisabled ? (
          <ChevronDown className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        ) : null}
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">{menu}</Dropdown.Popover>
    </Dropdown>
  );
}
