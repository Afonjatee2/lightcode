import { describe, expect, it } from "vitest";
import { humanIntentTitle, summarizeShellCommand } from "./commandSummary";

describe("summarizeShellCommand", () => {
  it("pulls PowerShell -Command single-quoted script", () => {
    const full = String.raw`cd C:\Users\work\proj && "C:\\Program Files\\pwsh\\pwsh.exe" -Command 'Get-Content src/renderer/state/slices/runtimeEventSlice.ts'`;
    expect(summarizeShellCommand(full)).toBe(
      "Get-Content src/renderer/state/slices/runtimeEventSlice.ts",
    );
  });

  it("unescapes doubled single-quotes inside PS -Command", () => {
    const full = `cd /tmp && pwsh -Command 'Write-Output ''hi'''`;
    expect(summarizeShellCommand(full)).toBe(`Write-Output 'hi'`);
  });

  it("falls back to last && segment when no -Command match", () => {
    expect(summarizeShellCommand("cd /a && cd /b && pnpm exec oxfmt src/foo.ts")).toBe(
      "pnpm exec oxfmt src/foo.ts",
    );
  });

  it("returns trimmed full string when already short", () => {
    expect(summarizeShellCommand("  ls -la  ")).toBe("ls -la");
  });
});

describe("humanIntentTitle", () => {
  it("describes Get-Content as read file", () => {
    const full = String.raw`cd C:\proj && pwsh -Command 'Get-Content src/shared/contracts/agentInstance.ts'`;
    expect(humanIntentTitle(full)).toBe("Read file: agentInstance.ts");
  });

  it("uses Check: for lint/typecheck scripts", () => {
    expect(humanIntentTitle(`cd /x && pnpm run lint`)).toBe("Check: pnpm run lint");
    expect(humanIntentTitle(`npm run typecheck`)).toBe("Check: npm run typecheck");
  });

  it("labels oxfmt via pnpm exec", () => {
    expect(humanIntentTitle("cd /p && pnpm exec oxfmt a.ts b.ts")).toBe("Format files");
  });

  it("strips PowerShell cd …; before intent", () => {
    const full = 'cd "c:\\Users\\me\\work\\lightcode"; pnpm exec oxfmt src/a.ts';
    expect(humanIntentTitle(full)).toBe("Format files");
  });
});
