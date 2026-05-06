import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  locationKind: text("location_kind").notNull(), // "windows" | "wsl" | "posix"
  locationPath: text("location_path"), // for windows/posix
  locationDistro: text("location_distro"), // for wsl
  locationLinuxPath: text("location_linux_path"), // for wsl
  locationUncPath: text("location_unc_path"), // for wsl
  lastDraftConfig: text("last_draft_config"), // JSON
  scripts: text("scripts"), // JSON
  searchSettings: text("search_settings"), // JSON
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  agentKind: text("agent_kind").notNull(), // provider kind
  /** Optional id of a user-registered ACP instance backing this thread. */
  agentInstanceId: text("agent_instance_id"),
  config: text("config").notNull(), // JSON
  status: text("status").notNull(),
  attention: text("attention").notNull(),
  canResumeWithConfig: integer("can_resume_with_config", { mode: "boolean" })
    .notNull()
    .default(false),
  sessionRef: text("session_ref"), // JSON
  terminalPrompt: text("terminal_prompt"), // JSON
  worktreePath: text("worktree_path"),
  worktreeBranch: text("worktree_branch"),
  prNumber: integer("pr_number"),
  groupId: text("group_id"),
  groupName: text("group_name"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  /** "terminal" (xterm-backed PTY) vs "gui" (renderer-native chat). */
  presentationMode: text("presentation_mode").notNull().default("terminal"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});

/**
 * Persisted canonical chat items per thread (for renderer-native chat mode).
 * Mirrors the renderer's `RuntimeChatItem` shape so we can hydrate the chat
 * UI when the user reopens a thread.
 */
export const threadRuntimeItems = sqliteTable("thread_runtime_items", {
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  position: integer("position").notNull(),
  type: text("type").notNull(),
  state: text("state").notNull(),
  payload: text("payload"), // JSON, nullable
  streams: text("streams"), // JSON of Partial<Record<RuntimeContentStreamKind, string>>
});
