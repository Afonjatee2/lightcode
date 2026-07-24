import { z } from "zod";
import { projectLocationSchema } from "./common";
import { mcpProbeErrorSchema, mcpServerSchema } from "./mcpServer";

/**
 * Generic "invoke one MCP tool and return its result" IPC procedure. This is
 * the renderer-callable sibling of `probeMcpServer` (which only discovers
 * tool names): it performs a real `tools/call` against a resolved
 * `McpServer` and reports back a safe, credential-free result.
 *
 * Kept domain-agnostic on purpose — callers (e.g. the campaign-context
 * hooks) own the tool name, arguments, and response-shape validation.
 */
export const mcpToolCallPayloadSchema = z.object({
  server: mcpServerSchema,
  /** Present for a workspace-scoped call; mirrors `mcpProbePayloadSchema`. */
  projectLocation: projectLocationSchema.optional(),
  toolName: z.string().min(1),
  args: z.unknown().optional(),
});
export type McpToolCallPayload = z.infer<typeof mcpToolCallPayloadSchema>;

const mcpToolCallResultBaseSchema = z.object({
  latencyMs: z.number().int().nonnegative(),
  environment: z.object({ runtime: z.enum(["host", "wsl"]), projectScoped: z.boolean() }),
});

export const mcpToolCallResultSchema = z.discriminatedUnion("status", [
  mcpToolCallResultBaseSchema.extend({
    status: z.literal("ok"),
    /** The tool's `structuredContent`, parsed JSON text, or raw text. */
    content: z.unknown(),
  }),
  mcpToolCallResultBaseSchema.extend({
    status: z.literal("auth-required"),
    error: mcpProbeErrorSchema.extend({ code: z.literal("auth-required") }),
  }),
  mcpToolCallResultBaseSchema.extend({
    status: z.literal("unavailable"),
    error: mcpProbeErrorSchema,
  }),
  mcpToolCallResultBaseSchema.extend({
    /** The server connected fine but the tool call itself returned `isError`. */
    status: z.literal("tool-error"),
    message: z.string().min(1),
  }),
]);
export type McpToolCallResult = z.infer<typeof mcpToolCallResultSchema>;
