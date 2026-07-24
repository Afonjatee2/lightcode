import { z } from "zod";

export const workspaceMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  authorAgentKind: z.string().min(1).optional(),
  authorModel: z.string().min(1).optional(),
  content: z.string().min(1),
  structuredContent: z.unknown().optional(),
  parentMessageId: z.string().min(1).optional(),
  consultationId: z.string().min(1).optional(),
  evidencePacketId: z.string().min(1).optional(),
  createdOnDeviceId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});
export type WorkspaceMessage = z.infer<typeof workspaceMessageSchema>;
