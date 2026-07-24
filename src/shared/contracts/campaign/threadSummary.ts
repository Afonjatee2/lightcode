import { z } from "zod";

export const threadSummarySchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  throughMessageId: z.string().min(1),
  summary: z.string().min(1),
  decisions: z.array(z.string().min(1)),
  openQuestions: z.array(z.string().min(1)),
  nextActions: z.array(z.string().min(1)),
  generatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
