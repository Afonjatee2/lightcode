# Slash commands in ACP composer

## Problem

GUI/ACP chat composers currently support inline composer chrome (`ThreadComposerSection` fixed content) and `@` file mentions, but they do not surface slash commands. The requested UX is a command list rendered inside the composer panel, styled like the pinned todo dock, with scroll and keyboard navigation for all ACP chat threads.

## Proposed approach

1. Normalize slash-command metadata onto the agent capability path the renderer already receives. `AgentCapability.slashCommands` already exists, but today only Claude populates it; ACP-backed adapters will need an equivalent source before the UI can be provider-agnostic.
2. Add a composer command panel for GUI/ACP threads in `ThreadComposerSection`, rendered in the existing fixed-content stack above the input. Reuse the todo-dock visual language and scroll behavior so the new panel looks native to the current composer chrome.
3. Extend `MentionInput` so `/` opens a command picker for the current token, arrows move the active row, Enter/Tab choose the command, Escape closes it, and the chosen command is inserted as plain prompt text without changing attachment or mention behavior.
4. Cover the capability plumbing and renderer behavior with tests for ACP chat threads, command visibility/filtering, keyboard navigation, and insertion.

## Todos

1. **acp-slash-command-source** — Identify how each ACP-backed adapter can provide slash command metadata and expose it through `AgentCapability.slashCommands`, keeping the renderer provider-agnostic.
2. **composer-slash-command-panel** — Add a composer-fixed slash command panel for GUI/ACP threads, matching the todo-dock chrome and supporting scroll for long command lists.
3. **mention-input-slash-navigation** — Extend `MentionInput` slash-trigger detection, filtering, active-row state, and command insertion while preserving existing `@` mention and submit behavior.
4. **slash-command-test-coverage** — Add renderer/composer tests for ACP chat visibility, keyboard navigation, scroll-to-active behavior, and command selection/insertion.

## Notes

- `ThreadComposerSection` is the right integration point because it already owns ACP composer chrome such as todo, error, pending-steer, and runtime-request panels.
- `MentionInput` already owns arrow/enter/tab/escape handling for `@` mentions; slash commands should reuse or generalize that state machine instead of adding a second competing keyboard layer.
- HeroUI `ListBox` is already used elsewhere in the renderer and is a good fit for accessible keyboard navigation if the slash panel becomes a dedicated list component.
- The current ACP probe flow (`src/supervisor/agents/acp/probe.ts`) exposes models, modes, and config options, but the checked SDK/schema does not obviously expose a slash-command catalog. If ACP itself cannot enumerate commands, adapter-specific probes or static provider catalogs may be required.
- Slash commands can stay in the existing prompt serialization path as plain text unless a provider later needs structured command payloads.
