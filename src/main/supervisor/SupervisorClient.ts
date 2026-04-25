import { fork, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { terminateChildProcessTree } from "@/shared/processTree";
import type {
  IpcProcedurePayload,
  IpcProcedureResult,
  SupervisorEvent,
  SupervisorProcedureName,
  SupervisorReply,
  SupervisorRequest,
} from "@/shared/ipc";

function isSupervisorReply(message: unknown): message is SupervisorReply {
  return typeof message === "object" && message !== null && "replyTo" in message;
}

/**
 * Electron / Windows: a forked supervisor with stdio "inherit" often does
 * not surface `console.log` in the same dev terminal as the main process.
 * Pipe stdout/stderr and write through the parent's stdio so hook-debug and
 * other supervisor logs are visible next to `[db]` / main-process lines.
 */
function pipeSupervisorStreamsToParent(child: ChildProcess): void {
  const pipeTo = (stream: Readable | null | undefined, out: NodeJS.WriteStream): void => {
    if (!stream) return;
    stream.on("data", (chunk: string | Buffer) => {
      out.write(chunk);
    });
  };
  pipeTo(child.stdout, process.stdout);
  pipeTo(child.stderr, process.stderr);
}

export interface SupervisorClientOptions {
  supervisorPath: string;
  /**
   * Directory containing the in-WSL helpers shipped with the app
   * (`watcher.node`, `bridge.mjs`). Forwarded to the supervisor via
   * `LIGHTCODE_WSL_HELPERS_DIR` so the bridge server can stage assets
   * into running distros.
   */
  wslHelpersDir: string;
  assignPid?(pid: number): Promise<void>;
  onEvent(event: SupervisorEvent): void;
  onReset(): void;
}

export class SupervisorClient {
  private child: ChildProcess | null = null;
  private baseDir: string | null = null;
  private disposed = false;
  private readonly startedGate: Promise<void>;
  private resolveStartedGate!: () => void;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor(private readonly options: SupervisorClientOptions) {
    this.startedGate = new Promise<void>((resolve) => {
      this.resolveStartedGate = resolve;
    });
  }

  private rejectPendingRequests(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private reset(error: Error): void {
    this.rejectPendingRequests(error);
    this.options.onReset();
  }

  start(baseDir: string): void {
    this.baseDir = baseDir;
    this.resolveStartedGate();
    this.stop(new Error("Supervisor restarting"));

    const child = fork(this.options.supervisorPath, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        LIGHTCODE_DATA_DIR: baseDir,
        LIGHTCODE_WSL_HELPERS_DIR: this.options.wslHelpersDir,
        // Back-compat for one release; older supervisor builds still read
        // the legacy var. Safe to drop once min supported supervisor knows
        // about LIGHTCODE_WSL_HELPERS_DIR.
        LIGHTCODE_WSL_WATCHER_DIR: this.options.wslHelpersDir,
      },
    });

    pipeSupervisorStreamsToParent(child);

    this.child = child;
    if (typeof child.pid === "number") {
      void this.options.assignPid?.(child.pid).catch((error) => {
        console.error(
          "[lightcode] failed to assign supervisor to Windows Job Object:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }

    child.on("message", (message: SupervisorReply | SupervisorEvent) => {
      if (isSupervisorReply(message)) {
        const pending = this.pendingRequests.get(message.replyTo);
        if (!pending) {
          return;
        }
        this.pendingRequests.delete(message.replyTo);
        if (message.ok) {
          pending.resolve(message.data);
        } else {
          pending.reject(new Error(message.error));
        }
        return;
      }

      this.options.onEvent(message);
    });

    child.on("exit", (code) => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.reset(new Error("Supervisor exited"));
      if (!this.disposed && code !== 0 && this.baseDir) {
        console.error(`[lightcode] supervisor exited with code ${code}, restarting…`);
        setTimeout(() => {
          if (!this.child && this.baseDir) {
            this.start(this.baseDir);
          }
        }, 1000);
      }
    });
  }

  stop(error: Error): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;
    this.reset(error);
    terminateChildProcessTree(child);
  }

  dispose(): void {
    this.disposed = true;
    this.resolveStartedGate();
    this.stop(new Error("Supervisor exited"));
  }

  async call<Name extends SupervisorProcedureName>(
    type: Name,
    payload: IpcProcedurePayload<Name>,
  ): Promise<IpcProcedureResult<Name>> {
    await this.startedGate;
    const child = this.child;
    if (!child || !child.connected) {
      return Promise.reject(new Error("Supervisor is not running."));
    }

    const id = randomUUID();
    const request: SupervisorRequest = {
      id,
      type,
      payload,
    } as SupervisorRequest;

    return new Promise<IpcProcedureResult<Name>>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as IpcProcedureResult<Name>),
        reject,
      });
      try {
        child.send(request, (error) => {
          if (!error) {
            return;
          }
          this.pendingRequests.delete(id);
          if ((error as NodeJS.ErrnoException).code === "EPIPE") {
            return;
          }
          reject(error);
        });
      } catch (error) {
        this.pendingRequests.delete(id);
        if ((error as NodeJS.ErrnoException).code === "EPIPE") {
          return;
        }
        reject(error);
      }
    });
  }
}
