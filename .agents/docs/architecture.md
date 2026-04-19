# Architecture & Code Organization

## Layers

- `src/main/`: Electron shell (`main.ts`), context-isolated preload bridge (`preload.ts`), SQLite database (`db.ts`, `db.schema.ts` via Drizzle ORM + better-sqlite3).
- `src/supervisor/`: Forked Node process owning all agent PTY sessions, git operations, terminal log persistence, agent status caching, and commit message generation. Entry point: `index.ts` (IPC dispatcher with Zod-validated payloads).
- `src/renderer/`: React 19 + HeroUI v3 + xterm.js. Zustand stores for state, persisted to SQLite via the preload bridge.
- `src/shared/`: Zod schemas, TypeScript types, IPC contracts (`ipc.ts`), and pure helpers (ANSI stripping, WSL path utilities, worktree path computation, theme resolution, agent status filtering).

## IPC Architecture

The main process forks the supervisor as a child process. Communication is UUID-keyed request/reply over `process.send()` + `process.on("message")`. The supervisor also emits fire-and-forget events (thread output, state changes, agent statuses) that the main process forwards to the renderer via `ipcRenderer`.

The preload bridge (`window.lightcode`) wraps all IPC into typed async methods defined by the `LightcodeBridge` interface in `src/shared/ipc.ts`.

## State Management

Zustand stores in `src/renderer/state/`. Each cross-cutting UI domain owns its own store — do not broaden an existing store to cover a new concern.

| Store                 | Persisted | Purpose                                                                                  |
| --------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `appStore`            | SQLite    | Projects, threads, panes, agent statuses, pending server requests, draft config          |
| `gitStore`            | No        | Per-project/per-worktree git status, PR data, branch lists, source info                  |
| `devTerminalStore`    | SQLite    | Shell session tabs, active project/worktree, per-tab activity tracking                   |
| `panelStore`          | Local     | Settings/project-settings open state, git+files side-panel context, right-panel tab      |
| `fileEditorStore`     | No        | Editor tabs, active path, preview tab, dirty buffers                                     |
| `projectTreeStore`    | No        | File tree expanded/loading paths, directory entries cache, drop target, committed search |
| `sharedSettingsStore` | SQLite    | Theme mode, commit generation provider/model/effort                                      |
| `agentStatusesStore`  | No        | Per-environment (Windows/WSL) agent install + auth status                                |
| `updateStore`         | No        | Auto-update phase, version, download progress                                            |
| `worktreeDeleteStore` | No        | Ephemeral UI state for worktree delete confirmation                                      |

Components connect to stores directly — avoid prop drilling. Subscriptions must be **narrow and primitive-returning** (see `editing-rules.md` → Store Subscriptions & Render Isolation). Per-entity boolean/string hooks (`useIsTabActive(path)`, `usePrState(key)`, `useIsPathExpanded(path)`) are the default pattern; whole-object subscriptions are banned on hot paths.

Companion selector modules (`fileEditorSelectors.ts`, `gitSelectors.ts`, `hooks/uiSelectors.ts`) house WeakMap-cached derivations keyed on store-array identity — first caller builds O(N), subsequent callers are O(1) until the store replaces the array.

## Build Pipeline

| Target       | Tool              | Entry                     | Output                     | Format                                                      |
| ------------ | ----------------- | ------------------------- | -------------------------- | ----------------------------------------------------------- |
| Renderer     | Vite 8 (Rolldown) | `src/renderer/main.tsx`   | `dist/renderer/`           | ESM, manual chunks (xterm, git-diff, ui, framework, vendor) |
| Main process | tsdown            | `src/main/main.ts`        | `dist/main/main.cjs`       | CJS, Node 24                                                |
| Preload      | tsdown            | `src/main/preload.ts`     | `dist/main/preload.cjs`    | CJS, Node 24                                                |
| Supervisor   | tsdown            | `src/supervisor/index.ts` | `dist/main/supervisor.cjs` | CJS, Node 24                                                |
| Distribution | electron-builder  | —                         | `release/`                 | NSIS (Win), AppImage+deb (Linux), DMG (macOS)               |

Native modules (`node-pty`, `better-sqlite3`, `electron`) are excluded from bundling and unpacked from ASAR.

## Database

SQLite via Drizzle ORM (`src/main/db.ts`). Tables: `projects`, `threads`, `appState`. The renderer reads/writes through preload bridge methods (`dbGetProjects`, `dbUpsertThread`, `dbSyncAll`, etc.). Zustand persistence uses a custom `dbStorage` backend.

## Git Integration

`src/supervisor/git.ts` wraps `simple-git` with location-aware path resolution (Windows native vs WSL UNC paths). Operations: status, diff (single + batch), stage/unstage/revert, commit, branch listing, fetch, worktree CRUD.

Commit message generation (`src/supervisor/commitMessageGenerator.ts`) spawns a one-shot agent CLI call with a conventional-commits prompt piped to stdin. Falls back across providers if the preferred one fails.

Worktree paths are computed within a centralized directory (`~/.lightcode/worktrees/<repo-id>/<branch-id>`) via `src/supervisor/git.ts` and `src/shared/worktree.ts`.
