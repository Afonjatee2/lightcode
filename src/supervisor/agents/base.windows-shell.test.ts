import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWindowsCommand,
  buildWindowsCmdCommand,
  quotePosixShellArg,
  quotePowerShellLiteral,
} from "./base";

const SPICY_PROMPT = [
  "let's `do` $this",
  "with 'single' and \"double\" quotes",
  "and meta & | < > ^ chars",
  "plus %SystemRoot% style refs",
].join("\n");

function decodePowerShellEncoded(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf16le");
}

describe("quotePowerShellLiteral", () => {
  it("wraps the value in single quotes and doubles inner single quotes", () => {
    expect(quotePowerShellLiteral("hi")).toBe("'hi'");
    expect(quotePowerShellLiteral("it's fine")).toBe("'it''s fine'");
  });

  it("leaves all other shell metachars literal inside single quotes", () => {
    // Inside PowerShell single-quoted literals, `$`, backtick, `%`, `&`, `|`,
    // `<`, `>`, `^`, newlines, and `"` are all literal — only `'` needs
    // escaping. This is the contract that buildWindowsCommand relies on for
    // pwsh.exe and powershell.exe.
    const quoted = quotePowerShellLiteral(SPICY_PROMPT);
    expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true);
    const inner = quoted.slice(1, -1);
    // The original `'`s in the source string get doubled.
    expect(inner.replaceAll("''", "'")).toBe(SPICY_PROMPT);
  });
});

describe("quotePosixShellArg", () => {
  it("preserves all metachars inside POSIX single quotes (only `'` is escaped)", () => {
    const quoted = quotePosixShellArg(SPICY_PROMPT);
    // The POSIX trick: close, escape with backslash, reopen — `'\''`.
    const reassembled = quoted.slice(1, -1).replaceAll(`'\\''`, "'");
    expect(reassembled).toBe(SPICY_PROMPT);
  });
});

describe.skipIf(process.platform !== "win32")("buildWindowsCommand", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.restoreAllMocks();
  });

  it("wraps spawns through pwsh.exe when PowerShell 7 is available", () => {
    const resolvePath = vi.fn<(name: string) => string | undefined>((name) =>
      name === "pwsh.exe" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : undefined,
    );

    const spec = buildWindowsCommand("C:\\repo", "claude", [SPICY_PROMPT], resolvePath);

    expect(spec.command).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    expect(spec.args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-EncodedCommand"]);
    const script = decodePowerShellEncoded(spec.args.at(-1)!);
    expect(script).toContain(quotePowerShellLiteral("claude"));
    expect(script).toContain(quotePowerShellLiteral(SPICY_PROMPT));
  });

  it("falls back to powershell.exe (PS 5.1) when pwsh is missing", () => {
    const resolvePath = vi.fn<(name: string) => string | undefined>((name) =>
      name === "powershell.exe"
        ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        : undefined,
    );

    const spec = buildWindowsCommand("C:\\repo", "claude", [SPICY_PROMPT], resolvePath);

    expect(spec.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const script = decodePowerShellEncoded(spec.args.at(-1)!);
    expect(script).toContain(quotePowerShellLiteral(SPICY_PROMPT));
  });

  it("falls back to cmd.exe when no PowerShell is available, passing args raw", () => {
    const resolvePath = vi.fn<(name: string) => string | undefined>(() => undefined);

    const spec = buildWindowsCommand("C:\\repo", "claude", [SPICY_PROMPT], resolvePath);

    expect(spec.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(spec.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(spec.args.at(-1)).toBe(SPICY_PROMPT);
  });
});

describe.skipIf(process.platform !== "win32")("buildWindowsCmdCommand", () => {
  it("preserves the prompt as a single trailing arg for the cmd.exe path", () => {
    // node-pty/Windows applies CommandLineToArgvW reverse quoting per arg, so
    // each arg here is what cmd.exe sees (one quoted token). `%var%` in the
    // prompt would still be expanded by cmd.exe; PowerShell paths above avoid
    // that, and cmd.exe is only reached when no PS is installed.
    const spec = buildWindowsCmdCommand("C:\\repo", "claude", [SPICY_PROMPT]);
    expect(spec.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(spec.args).toEqual(["/d", "/s", "/c", "claude", SPICY_PROMPT]);
  });
});
