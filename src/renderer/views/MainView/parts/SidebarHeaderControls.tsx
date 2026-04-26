import { startTransition } from "react";
import { FolderPlus, Monitor } from "lucide-react";
import { Button, Dropdown, Label } from "@heroui/react";
import { TuxIcon } from "@/renderer/components/common";
import { parseWslUncPath } from "@/shared/wsl";
import { isWindows, readBridge } from "@/renderer/bridge";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  type ThreadSortMode,
  sortModeOrder,
  sortModeIcon,
  sortModeLabel,
} from "@/renderer/views/MainView/parts/Sidebar/parts/sortMode";
import { autoDetectSetupScript } from "@/renderer/utils/gitHelpers";

export function SidebarHeaderControls(props: { wslAvailable: boolean }) {
  const { wslAvailable } = props;
  const addProject = useAppStore((state) => state.addProject);
  const openDraft = useAppStore((state) => state.openDraft);
  const threadSortMode = usePanelStore((s) => s.threadSortMode);

  return (
    <div className="lightcode-overlay-header__controls flex items-center gap-1.5">
      {isWindows() ? (
        <Dropdown>
          <Button
            isIconOnly
            aria-label="Add project"
            size="sm"
            variant="ghost"
            className="size-6 min-w-0 text-muted hover:text-foreground"
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="Add project options"
              onAction={(key) => {
                if (key === "windows") {
                  void readBridge()
                    .pickFolder()
                    .then((path) => {
                      if (!path) return;
                      startTransition(() => {
                        const project = addProject({ kind: "windows", path });
                        autoDetectSetupScript(project);
                        openDraft(project.id);
                      });
                    });
                }
                if (key === "wsl") {
                  void readBridge()
                    .listWslDistros()
                    .then((distros) => {
                      const distro = distros[0];
                      const defaultPath = distro ? `\\\\wsl.localhost\\${distro}\\home` : undefined;
                      return readBridge().pickFolder(defaultPath);
                    })
                    .then((selectedPath) => {
                      if (!selectedPath) return;
                      const parsed = parseWslUncPath(selectedPath);
                      if (!parsed) return;
                      startTransition(() => {
                        const project = addProject({
                          kind: "wsl",
                          distro: parsed.distro,
                          linuxPath: parsed.linuxPath,
                          uncPath: selectedPath,
                        });
                        autoDetectSetupScript(project);
                        openDraft(project.id);
                      });
                    });
                }
              }}
            >
              <Dropdown.Item id="windows" textValue="Add Windows Project">
                <Monitor className="size-4 shrink-0 text-muted" />
                <Label>Add Windows Project</Label>
              </Dropdown.Item>
              <Dropdown.Item id="wsl" isDisabled={!wslAvailable} textValue="Add WSL Project">
                <TuxIcon className="size-4 shrink-0 text-muted" />
                <Label>Add WSL Project</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      ) : (
        <Button
          isIconOnly
          aria-label="Add project"
          size="sm"
          variant="ghost"
          className="size-6 min-w-0 text-muted hover:text-foreground"
          onPress={() => {
            void readBridge()
              .pickFolder()
              .then((path) => {
                if (!path) return;
                startTransition(() => {
                  const project = addProject({ kind: "posix", path });
                  autoDetectSetupScript(project);
                  openDraft(project.id);
                });
              });
          }}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      )}
      <Dropdown>
        <Button
          isIconOnly
          aria-label="Sort threads"
          size="sm"
          variant="ghost"
          className="size-6 min-w-0 text-muted hover:text-foreground"
        >
          {(() => {
            const Icon = sortModeIcon[threadSortMode];
            return <Icon className="size-3.5" />;
          })()}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label="Thread sort order"
            selectionMode="single"
            selectedKeys={[threadSortMode]}
            onAction={(key) => {
              usePanelStore.getState().setThreadSortMode(key as ThreadSortMode);
            }}
          >
            {sortModeOrder.map((mode) => {
              const Icon = sortModeIcon[mode];
              return (
                <Dropdown.Item key={mode} id={mode} textValue={sortModeLabel[mode]}>
                  <Icon className="size-4 shrink-0 text-muted" />
                  <Label>{sortModeLabel[mode]}</Label>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
