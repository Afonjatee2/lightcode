import type { StatusTone } from "../statusTone";
import { StatusIcon } from "../StatusIcon";

// Official OpenCode brand mark (https://opencode.ai/brand). Source SVG (240×300):
//   - Dark frame: outer 240×300 with inner 120×180 cutout (60,60 → 180,240).
//   - Light panel: 120×120 inner rectangle (60,120 → 180,240).
// We render the frame as the primary tonal element and the panel as a
// reduced-opacity secondary path (via StatusIcon's `secondaryPath`) so the
// brand's two-tone contrast survives our single-color tone system.
const OPENCODE_FRAME_PATH = "M0 0 H240 V300 H0 Z M60 60 H180 V240 H60 Z";
const OPENCODE_PANEL_PATH = "M60 120 H180 V240 H60 Z";

export function OpenCodeIcon(props: { tone?: StatusTone; className?: string }) {
  return (
    <StatusIcon
      cssPrefix="lightcode-opencode-icon"
      path={OPENCODE_FRAME_PATH}
      secondaryPath={OPENCODE_PANEL_PATH}
      fillRule="evenodd"
      tone={props.tone ?? "inactive"}
      viewBox="0 0 240 300"
      className={props.className}
    />
  );
}
