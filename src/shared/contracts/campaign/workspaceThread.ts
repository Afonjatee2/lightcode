import { z } from "zod";

export const workspaceThreadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  topicType: z.string().min(1).optional(),
  parentThreadId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  preferredAgentKind: z.string().min(1).optional(),
  preferredModel: z.string().min(1).optional(),
  status: z.enum(["active", "done", "archived"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().nonnegative(),
});
export type WorkspaceThread = z.infer<typeof workspaceThreadSchema>;
