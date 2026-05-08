import { describe, expect, it } from "vitest";
import { attachErrorDetails, friendlyError, friendlyErrorWithDetail } from "./messages";

describe("friendlyErrorWithDetail", () => {
  it("returns the raw message and no details for plain errors", () => {
    const result = friendlyErrorWithDetail(new Error("something broke"));
    expect(result).toEqual({ summary: "something broke", details: "" });
  });

  it("strips the Electron IPC wrapper prefix", () => {
    const wrapped = new Error("Error invoking remote method 'gitCommit': Error: real message");
    expect(friendlyError(wrapped)).toBe("real message");
  });

  it("splits an attached details block out of the message", () => {
    const composed = attachErrorDetails("Git commit failed: stuff", "stderr line 1\nstderr line 2");
    const result = friendlyErrorWithDetail(new Error(composed));
    expect(result.summary).toBe("Git commit failed: stuff");
    expect(result.details).toBe("stderr line 1\nstderr line 2");
  });

  it("classifies husky output as a pre-commit hook failure", () => {
    const stderr = [
      "running pre-commit",
      "husky - pre-commit hook exited with code 1 (error)",
    ].join("\n");
    const composed = attachErrorDetails("Git commit failed: ...", stderr);
    const result = friendlyErrorWithDetail(new Error(composed));
    expect(result.summary).toBe("Pre-commit hook failed");
    expect(result.details).toContain("husky - pre-commit");
  });

  it("classifies bash hook noise based on .husky/ paths in stderr", () => {
    const stderr = [
      "/bin/bash: line 1: setSportsMaxSignals: command not found",
      ".husky/pre-commit: line 7: unexpected token",
    ].join("\n");
    const composed = attachErrorDetails("Git commit failed: bash exited 2", stderr);
    const result = friendlyErrorWithDetail(new Error(composed));
    expect(result.summary).toBe("Pre-commit hook failed");
    expect(result.details).toContain("setSportsMaxSignals");
  });

  it("does not treat unrelated git errors as hook failures", () => {
    const composed = attachErrorDetails(
      "Git commit failed: nothing to commit, working tree clean",
      "",
    );
    const result = friendlyErrorWithDetail(new Error(composed));
    expect(result.summary).toContain("nothing to commit");
    expect(result.details).toBe("");
  });
});
