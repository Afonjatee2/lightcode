import { z } from "zod";
import { projectLocationSchema } from "./common";
import { projectDraftConfigSchema } from "./config";

export const projectActionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  icon: z.string().optional(),
});
export type ProjectAction = z.infer<typeof projectActionSchema>;

export const projectScriptsSchema = z.object({
  setupScript: z.string().optional(),
  cleanupScript: z.string().optional(),
  actions: z.array(projectActionSchema).default([]),
});
export type ProjectScripts = z.infer<typeof projectScriptsSchema>;

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: projectLocationSchema,
  lastDraftConfig: projectDraftConfigSchema.optional(),
  scripts: projectScriptsSchema.optional(),
  createdAt: z.string().min(1),
});
export type Project = z.infer<typeof projectSchema>;
