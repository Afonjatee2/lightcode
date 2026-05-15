import { beforeEach, describe, expect, it } from "vitest";
import {
  migratePaneSizeStorage,
  readStoredSizes,
  SPLIT_SIZE_STORAGE_PREFIX,
  swapPaneIdsInStorage,
  writeStoredSizes,
} from "./paneSizeStorage";

function key(axis: "vertical" | "horizontal", ids: string[]): string {
  return `${SPLIT_SIZE_STORAGE_PREFIX}:${axis}:${ids.join("\0")}`;
}

describe("paneSizeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("migratePaneSizeStorage", () => {
    it("renames a single pane id in the storage key while preserving sizes", () => {
      writeStoredSizes(key("vertical", ["draft-a", "thread-x"]), [70, 30]);
      migratePaneSizeStorage("draft-a", "thread-a");
      expect(readStoredSizes(key("vertical", ["draft-a", "thread-x"]), 2)).toEqual([50, 50]);
      expect(readStoredSizes(key("vertical", ["thread-a", "thread-x"]), 2)).toEqual([70, 30]);
    });

    it("is a no-op when old and new ids are equal", () => {
      writeStoredSizes(key("vertical", ["a", "b"]), [60, 40]);
      migratePaneSizeStorage("a", "a");
      expect(readStoredSizes(key("vertical", ["a", "b"]), 2)).toEqual([60, 40]);
    });

    it("leaves unrelated keys untouched", () => {
      writeStoredSizes(key("vertical", ["a", "b"]), [70, 30]);
      writeStoredSizes(key("vertical", ["c", "d"]), [25, 75]);
      migratePaneSizeStorage("a", "z");
      expect(readStoredSizes(key("vertical", ["z", "b"]), 2)).toEqual([70, 30]);
      expect(readStoredSizes(key("vertical", ["c", "d"]), 2)).toEqual([25, 75]);
    });
  });

  describe("swapPaneIdsInStorage", () => {
    it("swaps two pane ids in a single split, preserving slot sizes", () => {
      // Three panes [A, X, Y] sized 20/30/50. After swapping A and Y, the
      // layout becomes [Y, X, A] but slot widths must stay 20/30/50 so the
      // visual placements don't jump.
      writeStoredSizes(key("vertical", ["A", "X", "Y"]), [20, 30, 50]);
      swapPaneIdsInStorage("A", "Y");
      expect(readStoredSizes(key("vertical", ["Y", "X", "A"]), 3)).toEqual([20, 30, 50]);
      // Old key is gone.
      expect(localStorage.getItem(key("vertical", ["A", "X", "Y"]))).toBeNull();
    });

    it("swaps pane ids across two different splits, preserving each slot's size", () => {
      writeStoredSizes(key("vertical", ["A", "X", "Y"]), [20, 30, 50]);
      writeStoredSizes(key("horizontal", ["P", "Q", "B"]), [40, 35, 25]);
      swapPaneIdsInStorage("A", "B");
      expect(readStoredSizes(key("vertical", ["B", "X", "Y"]), 3)).toEqual([20, 30, 50]);
      expect(readStoredSizes(key("horizontal", ["P", "Q", "A"]), 3)).toEqual([40, 35, 25]);
    });

    it("is a no-op when the two ids are equal", () => {
      writeStoredSizes(key("vertical", ["a", "b"]), [60, 40]);
      swapPaneIdsInStorage("a", "a");
      expect(readStoredSizes(key("vertical", ["a", "b"]), 2)).toEqual([60, 40]);
    });

    it("leaves keys that contain neither id untouched", () => {
      writeStoredSizes(key("vertical", ["c", "d"]), [70, 30]);
      swapPaneIdsInStorage("a", "b");
      expect(readStoredSizes(key("vertical", ["c", "d"]), 2)).toEqual([70, 30]);
    });
  });
});
