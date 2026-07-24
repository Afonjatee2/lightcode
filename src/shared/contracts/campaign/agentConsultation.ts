import { z } from "zod";

export const agentConsultationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentMessageId: z.string().min(1),
  childThreadId: z.string().min(1).optional(),
  requestedAgentKind: z.string().min(1),
  requestedModel: z.string().min(1).optional(),
  mode: z.enum(["review", "verify", "challenge", "research", "panel"]),
  instruction: z.string().min(1),
  contextPacketId: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  costEstimate: z.number().finite().nonnegative().optional(),
  actualCost: z.number().finite().nonnegative().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type AgentConsultation = z.infer<typeof agentConsultationSchema>;
export type AgentConsultationStatus = AgentConsultation["status"];
