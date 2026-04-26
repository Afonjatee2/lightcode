import { isWindows } from "@/renderer/bridge";

/**
 * Shared left-sidebar chrome: main app thread list, overflow/git/settings/file-editor panels.
 * One place to tweak column padding, scroll gutter, and footer dividers.
 */

/** Column shell (inset `px-2`); pair with `overlaySidebarSurfaceClass` for overlay/panel UIs. */
export const sidebarColumnLayoutClass = "flex h-full min-h-0 min-w-0 flex-col gap-3 px-2 pb-1 pt-0";

/** Primary surface for overlay and docked tool panels (matches main content / thread area). */
export const overlaySidebarSurfaceClass = "bg-[var(--content-background)]";

/** File editor, git, settings overlays, etc.: layout + background. */
export const overlaySidebarColumnClass = `${sidebarColumnLayoutClass} ${overlaySidebarSurfaceClass}`;

/**
 * Right-docked git tool: same as {@link overlaySidebarColumnClass} but `px-0` on the column so
 * horizontal inset comes from row padding only (`useGitReviewRowPadX`), not column + row.
 */
export const gitPanelSidebarColumnClass = `flex h-full min-h-0 min-w-0 flex-col gap-0 ${overlaySidebarSurfaceClass} px-0 pb-1 pt-0`;

/**
 * Main scroll/split region: horizontal inset is on the column; scroll handles scrollbar margin.
 * Matches the primary app `Sidebar` scroll area (incl. non-Windows `pr-2` / `-mr-2` gutter).
 */
export function sidebarBodyScrollClass() {
  return `min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-0 -mr-2 [scrollbar-gutter:stable] ${
    !isWindows() ? "pr-2" : ""
  }`.trim();
}

/**
 * Git review file list: same scroll behavior plus vertical spacing between staged/changes groups.
 * @see {sidebarBodyScrollClass}
 */
export function gitReviewSidebarListScrollClass() {
  return `${sidebarBodyScrollClass()} space-y-2`;
}

/**
 * Sticky/variable footers: Return to app, Hide sidebar, etc. Border spans column inset only.
 * @see {sidebarColumnLayoutClass}
 */
export const sidebarFooterNavClass = "space-y-1 border-t border-white/6 pt-2";

/**
 * Collapsed icon rail: bottom block (pr keeps icons off the right edge in the narrow column).
 * @see {sidebarColumnLayoutClass}
 */
export const sidebarIconRailFooterClass = "space-y-1 border-t border-white/6 pt-2 pr-2";
