import type { SupervisorReply, SupervisorRequest } from "@/shared/ipc";
import { createSupervisorIpcHandlers } from "./ipcHandlers";
import { SupervisorRuntime } from "./runtime";

const runtime = new SupervisorRuntime((event) => {
  process.send?.(event);
});

const handlers = createSupervisorIpcHandlers(runtime);

let isShuttingDown = false;

function shutdownSupervisor(exitCode = 0): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  runtime.dispose();
  process.exit(exitCode);
}

async function handleRequest(request: SupervisorRequest): Promise<unknown> {
  const handler = handlers[request.type];
  return handler(request.payload as never);
}

process.on("message", async (message: SupervisorRequest) => {
  const reply = await handleRequest(message)
    .then(
      (data): SupervisorReply => ({
        replyTo: message.id,
        ok: true,
        data,
      }),
    )
    .catch(
      (error: unknown): SupervisorReply => ({
        replyTo: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  process.send?.(reply);
});

process.on("disconnect", () => {
  shutdownSupervisor(0);
});

process.on("SIGINT", () => {
  shutdownSupervisor(0);
});

process.on("SIGTERM", () => {
  shutdownSupervisor(0);
});

process.on("uncaughtException", (error) => {
  console.error("[supervisor] uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[supervisor] unhandled rejection:", reason);
});
