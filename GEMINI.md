# Lightcode Agent Rules

## Product Invariants

- Lightcode is terminal-native. Every live thread must be backed by a real CLI process attached to a PTY.
- Do not re-render CLI output as chat bubbles or semantic message blocks.
- The terminal viewport is the source of truth. Any sidebar badge, loading state, or attention marker is advisory only.
- One thread maps to one active PTY session at a time.

## Runtime Rules

- The renderer must never spawn agent processes directly.
- Agent processes are owned by the supervisor runtime only.
- Windows projects run with a native Windows cwd.
- WSL projects run through `wsl.exe -d <distro> --cd <linuxPath> -- <agent command>`.
- Structured runtimes such as Codex App Server or Claude SDK must not silently replace native PTY-backed threads.

## UI Rules

- Use HeroUI v3 first for all non-terminal UI.
- The terminal surface stays `xterm.js`, wrapped by HeroUI-aware layout components.
- LLM-assisted UI changes must follow the local HeroUI v3 docs under `./.heroui-docs/react`.
- Theme support is required from the start: light, dark, and system.

## Tooling Rules

- Package manager: `pnpm`
- Primary typecheck: `pnpm run typecheck`
- Compatibility typecheck: `pnpm run typecheck:compat`
- Lint: `pnpm run lint`
- Format check: `pnpm run fmt:check`
- Format write: `pnpm run fmt`
- Tests: `pnpm run test`
- HeroUI and Tailwind CSS v4 styling setup must stay wired for dev and build.
- React Compiler is enabled in the renderer through Vite 8, `@vitejs/plugin-react`, `@rolldown/plugin-babel`, and `babel-plugin-react-compiler`.
- Keep `babel-plugin-react-compiler` pinned to an exact version unless explicitly updating and revalidating it.

## Code Organization

- `src/main`: Electron shell and preload bridge.
- `src/supervisor`: PTY runtime, agent adapters, WSL routing, persistence, heuristics.
- `src/renderer`: React, HeroUI v3, xterm integration, local app state.
- `src/renderer/components/providers/`: Per-provider UI (icons, controls). One directory per provider. Shared provider utilities (e.g. `statusTone.ts`, `StatusIcon.tsx`) live at the providers root.
- `src/renderer/components/common/`: Generic, provider-agnostic UI components only.
- `src/shared`: contracts, types, helpers, command builders, path utilities.

## Agent Adapter Rules

- Every supported agent must provide:
  - install detection
  - capability discovery
  - launch command building
  - resume command building
  - attention hint derivation (optional `detectTerminalStatus` for terminal-mode agents)
- Capability-based UI is required. Do not show fake controls that a CLI cannot support.
- Provider-specific logic (heuristics, commands, detection) stays in the adapter's own file under `src/supervisor/agents/`. The runtime calls adapter methods generically — no provider-specific if/else chains in runtime code.

## Reuse Rules

- Before creating a new component, check if an existing one already handles the use case.
- `ThreadComposer` supports an `inputContent` prop that replaces the textarea with custom content (e.g. prompt options, approval panels). Use this for any agent interaction that replaces the text input — do not create separate panels.
- `ThreadServerRequestPanel` handles structured server requests (Codex). Terminal-mode prompts use `inputContent` on the composer instead.
- `StatusIcon` is the shared animated icon wrapper. Provider icons (`ClaudeIcon`, `CodexStatusIcon`) are thin wrappers that pass their SVG path — do not duplicate animation logic.
- `getStatusTone()` maps thread status to icon tone for all providers. Do not create per-provider tone mappers.

## Editing Rules

- Preserve terminal fidelity over convenience.
- Keep the renderer thin. Hot-path logic belongs in the supervisor or shared helpers.
- Prefer explicit contracts and flat string rules over hidden conventions.
- Do not add `useMemo`, `useCallback`, or `React.memo` by default in renderer code. React Compiler is the default memoization strategy; manual memoization is an escape hatch.
- `useEffect` is still for real side effects and external synchronization. Prefer `useEffectEvent` and `startTransition` when they fit the interaction.
- Prefer Vite 8 Rolldown-native config like `rolldownOptions` over older Rollup-first guidance.
