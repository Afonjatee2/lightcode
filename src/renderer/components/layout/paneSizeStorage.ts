import { collectPaneIds, type PaneLayout, type PaneLayoutAxis } from "@/shared/paneLayout";

export const SPLIT_SIZE_STORAGE_PREFIX = "lightcode-pane-sizes";
const PANE_ID_SEPARATOR = "\0";

export const MIN_PANE_PERCENT = 15;

export function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

export function splitStorageKey(layout: PaneLayout, axis: PaneLayoutAxis): string {
  return `${SPLIT_SIZE_STORAGE_PREFIX}:${axis}:${collectPaneIds(layout).join(PANE_ID_SEPARATOR)}`;
}

function normalizeSizes(raw: number[], count: number): number[] | null {
  if (
    raw.length !== count ||
    raw.some((value) => !Number.isFinite(value) || value < MIN_PANE_PERCENT)
  ) {
    return null;
  }
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const normalized = raw.map((value) => (value / total) * 100);
  if (normalized.some((value) => value < MIN_PANE_PERCENT)) return null;
  return normalized;
}

export function readStoredSizes(key: string, count: number): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return equalSizes(count);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return equalSizes(count);
    return normalizeSizes(parsed, count) ?? equalSizes(count);
  } catch {
    return equalSizes(count);
  }
}

export function writeStoredSizes(key: string, sizes: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(sizes));
  } catch {
    // ignore quota / privacy errors
  }
}

/**
 * Rewrite split-size localStorage keys by remapping pane ids. The storage key
 * encodes the full pane id list (in tree order), so any change to that list —
 * a rename (draft → real thread id) or a swap (drag-to-replace pane reorder) —
 * shifts the key. Without rewriting the stored entry, `readStoredSizes` falls
 * back to equal sizes and the user's custom proportions are silently lost.
 *
 * Sizes are stored as a positional array; this only rewrites the *key*, so
 * size-per-slot is preserved while the contents of those slots change.
 */
function remapPaneIdsInStorage(mapper: (paneId: string) => string): void {
  if (typeof localStorage === "undefined") return;

  const matchingKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!key.startsWith(`${SPLIT_SIZE_STORAGE_PREFIX}:`)) continue;
    matchingKeys.push(key);
  }

  for (const key of matchingKeys) {
    const axisSeparator = key.indexOf(":", SPLIT_SIZE_STORAGE_PREFIX.length + 1);
    if (axisSeparator === -1) continue;
    const idsPart = key.slice(axisSeparator + 1);
    const ids = idsPart.split(PANE_ID_SEPARATOR);
    const nextIds = ids.map(mapper);
    if (nextIds.every((id, i) => id === ids[i])) continue;
    const nextKey = `${key.slice(0, axisSeparator + 1)}${nextIds.join(PANE_ID_SEPARATOR)}`;
    if (nextKey === key) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    try {
      localStorage.removeItem(key);
      localStorage.setItem(nextKey, value);
    } catch {
      // ignore quota / privacy errors
    }
  }
}

export function migratePaneSizeStorage(oldPaneId: string, newPaneId: string): void {
  if (oldPaneId === newPaneId) return;
  remapPaneIdsInStorage((id) => (id === oldPaneId ? newPaneId : id));
}

/**
 * Swap two pane ids in all split-size localStorage keys at once. Used when the
 * user drags one pane onto another to swap positions: each slot keeps its size,
 * only the pane id occupying that slot changes.
 */
export function swapPaneIdsInStorage(firstPaneId: string, secondPaneId: string): void {
  if (firstPaneId === secondPaneId) return;
  remapPaneIdsInStorage((id) => {
    if (id === firstPaneId) return secondPaneId;
    if (id === secondPaneId) return firstPaneId;
    return id;
  });
}
