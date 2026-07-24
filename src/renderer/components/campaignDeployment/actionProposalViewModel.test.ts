import { describe, expect, it } from "vitest";

import {
  formatDocketDateTime,
  formatDocketValue,
  isProposalActionable,
  isProposalExpired,
  isStrongConfirmationRequired,
  isTerminalStatus,
  STRONG_CONFIRMATION_PHRASE,
} from "./actionProposalViewModel";

const NOW = new Date("2026-07-22T12:00:00Z");

describe("actionProposalViewModel helpers", () => {
  describe("isProposalActionable", () => {
    it("is true only for awaiting_approval", () => {
      expect(isProposalActionable("awaiting_approval")).toBe(true);
      for (const status of [
        "draft",
        "approved",
        "rejected",
        "applying",
        "applied",
        "failed",
        "cancelled",
      ] as const) {
        expect(isProposalActionable(status)).toBe(false);
      }
    });
  });

  describe("isTerminalStatus", () => {
    it("is true for applied/rejected/cancelled only", () => {
      expect(isTerminalStatus("applied")).toBe(true);
      expect(isTerminalStatus("rejected")).toBe(true);
      expect(isTerminalStatus("cancelled")).toBe(true);
      expect(isTerminalStatus("awaiting_approval")).toBe(false);
      expect(isTerminalStatus("applying")).toBe(false);
      expect(isTerminalStatus("failed")).toBe(false);
    });
  });

  describe("isStrongConfirmationRequired", () => {
    it("requires confirmation for high and critical risk", () => {
      expect(
        isStrongConfirmationRequired({ level: "high", requiresStrongConfirmation: false }),
      ).toBe(true);
      expect(
        isStrongConfirmationRequired({ level: "critical", requiresStrongConfirmation: false }),
      ).toBe(true);
    });

    it("honours the server flag for low/medium risk", () => {
      expect(isStrongConfirmationRequired({ level: "low", requiresStrongConfirmation: true })).toBe(
        true,
      );
      expect(
        isStrongConfirmationRequired({ level: "medium", requiresStrongConfirmation: false }),
      ).toBe(false);
    });
  });

  describe("isProposalExpired", () => {
    it("is false without an expiry", () => {
      expect(isProposalExpired(undefined, NOW)).toBe(false);
    });

    it("is true at or after the expiry instant", () => {
      expect(isProposalExpired("2026-07-22T12:00:00Z", NOW)).toBe(true);
      expect(isProposalExpired("2026-07-22T11:59:59Z", NOW)).toBe(true);
    });

    it("is false before the expiry instant", () => {
      expect(isProposalExpired("2026-07-22T12:00:01Z", NOW)).toBe(false);
    });

    it("is false for unparseable dates", () => {
      expect(isProposalExpired("not-a-date", NOW)).toBe(false);
    });
  });

  describe("formatDocketDateTime", () => {
    it("renders a fallback for missing or invalid input", () => {
      expect(formatDocketDateTime(undefined)).toBe("—");
      expect(formatDocketDateTime("garbage")).toBe("—");
      expect(formatDocketDateTime(undefined, "n/a")).toBe("n/a");
    });

    it("renders a stable ISO-derived date for valid input", () => {
      const rendered = formatDocketDateTime("2026-07-22T10:30:00Z");
      expect(rendered).toContain("2026");
      expect(rendered).not.toBe("—");
    });
  });

  describe("formatDocketValue", () => {
    const labels = { yesLabel: "Yes", noLabel: "No" };

    it("renders null/empty via the empty label", () => {
      expect(formatDocketValue(null, labels)).toBe("—");
      expect(formatDocketValue("", labels)).toBe("—");
      expect(formatDocketValue(null, { ...labels, emptyLabel: "unset" })).toBe("unset");
    });

    it("maps booleans through supplied labels", () => {
      expect(formatDocketValue(true, labels)).toBe("Yes");
      expect(formatDocketValue(false, labels)).toBe("No");
    });

    it("formats numbers and appends units", () => {
      expect(formatDocketValue(600, labels)).toBe("600");
      expect(formatDocketValue(600, { ...labels, unit: "GBP" })).toBe("600 GBP");
      expect(formatDocketValue(3.125, labels)).toBe("3.13");
    });

    it("passes strings through and appends units", () => {
      expect(formatDocketValue("ENABLED", labels)).toBe("ENABLED");
      expect(formatDocketValue("50", { ...labels, unit: "%" })).toBe("50 %");
    });
  });

  describe("STRONG_CONFIRMATION_PHRASE", () => {
    it("is the stable, non-localized token APPROVE", () => {
      expect(STRONG_CONFIRMATION_PHRASE).toBe("APPROVE");
    });
  });
});
