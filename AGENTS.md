# Lightcode

Universal AI agent orchestrator — Electron desktop app managing Claude, Codex, and Gemini via real PTY sessions (terminal-native) and structured runtimes (native chat).

## Quick Reference

- **Package manager:** `pnpm` (10.30.3)
- **Node:** >= 24.10.0
- **Typecheck:** `pnpm run typecheck` (tsgo) / `pnpm run typecheck:compat` (tsc)
- **Lint:** `pnpm run lint` (oxlint)
- **Format:** `pnpm run fmt` (oxfmt) / `pnpm run fmt:check`
- **Test:** `pnpm run test` (vitest)
- **Dev:** `pnpm run dev`
- **Build:** `pnpm run build` then `pnpm run dist`

## Critical Rules

- Terminal-presentation threads must be backed by a real PTY process; GUI-presentation threads must be backed by the provider structured runtime process. The active presentation surface is the source of truth.
- The renderer must never spawn agent processes — the supervisor runtime owns all agent processes.
- React Compiler is the default memoization strategy. Do not add `useMemo`, `useCallback`, or `React.memo` unless escaping the compiler. Keep `babel-plugin-react-compiler` pinned to an exact version.
- Use HeroUI v3 for all non-terminal UI. When working with HeroUI components, always load the `heroui-react` skill first (`/skill heroui-react`).
- The codebase is provider-agnostic. Providers are self-contained plugins — both supervisor adapters and renderer UI. No provider-specific if/else in shared runtime, UI, or layout code. Adding a new provider should require zero changes to existing shared files.
- Windows projects use native Windows cwd. WSL projects run through `wsl.exe -d <distro> --cd <linuxPath> -- <agent command>`.

## Guidelines

- [Architecture & Code Organization](.agents/docs/architecture.md)
- [Agent Adapter Rules](.agents/docs/agent-adapters.md)
- [UI Patterns & Component Reuse](.agents/docs/ui-patterns.md)
- [Editing & React Patterns](.agents/docs/editing-rules.md)
