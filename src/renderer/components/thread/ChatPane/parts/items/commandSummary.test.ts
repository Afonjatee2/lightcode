import { describe, expect, it } from "vitest";
import { commandIntentDisplay, humanIntentTitle, summarizeShellCommand } from "./commandSummary";

describe("summarizeShellCommand", () => {
  it("pulls PowerShell -Command single-quoted script", () => {
    const full = String.raw`cd C:\Users\work\proj && "C:\\Program Files\\pwsh\\pwsh.exe" -Command 'Get-Content src/renderer/state/slices/runtimeEventSlice.ts'`;
    expect(summarizeShellCommand(full)).toBe(
      "Get-Content src/renderer/state/slices/runtimeEventSlice.ts",
    );
  });

  it("pulls POSIX shell -lc double-quoted script", () => {
    const full = `/bin/zsh -lc "sed -n '1,260p' src/supervisor/runtime.ts"`;
    expect(summarizeShellCommand(full)).toBe("sed -n '1,260p' src/supervisor/runtime.ts");
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
    expect(commandIntentDisplay(`pnpm run test`).kind).toBe("check");
  });

  it("labels oxfmt via pnpm exec", () => {
    expect(humanIntentTitle("cd /p && pnpm exec oxfmt a.ts b.ts")).toBe("Format files");
  });

  it("strips PowerShell cd …; before intent", () => {
    const full = 'cd "c:\\Users\\me\\work\\lightcode"; pnpm exec oxfmt src/a.ts';
    expect(humanIntentTitle(full)).toBe("Format files");
  });

  it("describes sed -n ranges as viewed lines", () => {
    const full = `/bin/zsh -lc "sed -n '1,260p' src/supervisor/runtime.ts"`;
    expect(humanIntentTitle(full)).toBe("View lines 1-260: src/supervisor/runtime.ts");
    expect(commandIntentDisplay(full).kind).toBe("view");
  });

  it("describes ripgrep commands as searches", () => {
    const full = `/bin/zsh -lc 'rg -n "agent status|AgentStatus" src/main src/supervisor src/shared -S'`;
    expect(humanIntentTitle(full)).toBe(
      'Search: "agent status|AgentStatus" in src/main src/supervisor src/shared',
    );
    expect(commandIntentDisplay(full).kind).toBe("search");
  });

  it("describes cat piped through sed as viewed lines", () => {
    const full = `cat node_modules/.modules.yaml 2>/dev/null | sed -n '1,180p'`;
    expect(humanIntentTitle(full)).toBe("View lines 1-180: node_modules/.modules.yaml");
    expect(commandIntentDisplay(full).kind).toBe("view");
  });

  it("describes find commands as searches", () => {
    const full = `find node_modules/.pnpm -maxdepth 4 -type f -name 'vitest.mjs' | sed -n '1,80p'`;
    expect(humanIntentTitle(full)).toBe('Search files: "vitest.mjs" in node_modules/.pnpm');
    expect(commandIntentDisplay(full).kind).toBe("search");
  });

  it("describes directory listings and package manager commands", () => {
    expect(humanIntentTitle("ls -la node_modules/.pnpm/vitest@4.1.5")).toBe(
      "List: node_modules/.pnpm/vitest@4.1.5",
    );
    expect(commandIntentDisplay("ls -la node_modules").kind).toBe("list");

    expect(humanIntentTitle("pnpm install --force --offline")).toBe(
      "Install packages: pnpm install",
    );
    expect(commandIntentDisplay("pnpm install --prod=false").kind).toBe("install");
    expect(humanIntentTitle("pnpm config list")).toBe("Package config: pnpm config list");
    expect(commandIntentDisplay("pnpm list --depth 0").kind).toBe("list");
    expect(commandIntentDisplay("pnpm --version").kind).toBe("package");
  });

  it("marks git commands with git intent", () => {
    expect(commandIntentDisplay("git diff -- src/foo.ts").kind).toBe("git");
  });
});
