// @vitest-environment node

import { describe, expect, it } from "vitest";
import "./codex";
import { getGuiSlashCommands } from "./providerSlashCommands";

describe("provider slash-command registry", () => {
  it("builds Codex commands from the active control capabilities", () => {
    const registration = getGuiSlashCommands("codex:work");

    expect(registration).toBeDefined();
    expect(
      registration?.buildCommands({ hasEffort: false, supportsFast: false }).map(({ id }) => id),
    ).toEqual(["model", "plan", "agent", "goal"]);
    expect(
      registration?.buildCommands({ hasEffort: true, supportsFast: true }).map(({ id }) => id),
    ).toEqual(["model", "plan", "agent", "goal", "effort", "fast"]);
  });

  it.each([
    [" /MODEL ", { kind: "open-control", target: "model" }],
    ["/effort", { kind: "open-control", target: "effort" }],
    ["/fast", { kind: "toggle-fast" }],
    ["/plan", { kind: "set-mode", mode: "plan" }],
    ["/agent", { kind: "set-mode", mode: "agent" }],
    ["/goal", null],
  ])("resolves local action %s", (typed, expected) => {
    expect(getGuiSlashCommands("codex")?.resolveLocalAction(typed)).toEqual(expected);
  });
});
