import { usePanelStore } from "@/renderer/state/panelStore";
import { OverlayShell } from "@/renderer/components/layout/OverlayShell";
import { BrowserPanel } from "./RightPanel/parts/BrowserPanel/BrowserPanel";

export function BrowserOverlay(props: { open: boolean }) {
  const { open } = props;
  const setBrowserOverlayOpen = usePanelStore((s) => s.setBrowserOverlayOpen);

  return (
    <OverlayShell open={open} onExited={() => setBrowserOverlayOpen(false)}>
      <BrowserPanel visible={open} />
    </OverlayShell>
  );
}
