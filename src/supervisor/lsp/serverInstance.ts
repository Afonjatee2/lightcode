import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type { ProjectLocation } from "@/shared/contracts";
import type { LspSessionStatus } from "@/shared/lsp";
import { terminateChildProcessTree } from "@/shared/processTree";
import { getProjectFsPath } from "@/shared/wsl";
import { quotePosixShellArg, resolveWslShellPath } from "../agents/base";
import type { LanguageServerConfig } from "./serverRegistry";

function getRootUri(location: ProjectLocation): string {
  if (location.kind === "wsl") return `file:///${location.linuxPath}`;
  const absPath = resolve(location.path).replace(/\\/g, "/");
  return `file:///${absPath}`;
}

/**
 * For native projects, resolve `node_modules/...` against the project root
 * so we pick up a locally-installed server before a global one.
 */
function resolveNativeCommand(cmd: string, projectRoot: string): string {
  if (cmd.startsWith("node_modules/")) {
    return resolve(projectRoot, cmd);
  }
  return cmd;
}

/**
 * Build a POSIX-style absolute path for a `node_modules/...` command inside
 * the distro. `path.resolve` is Windows-biased on win32 hosts (it prepends
 * a drive letter), so we do a string join instead.
 */
function resolveWslCommand(cmd: string, linuxPath: string): string {
  if (cmd.startsWith("node_modules/")) {
    return `${linuxPath}/${cmd}`;
  }
  return cmd;
}

export class ServerInstance {
  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private restartCount = 0;
  private disposed = false;

  constructor(
    readonly sessionId: string,
    private readonly config: LanguageServerConfig,
    private readonly projectLocation: ProjectLocation,
    private readonly onMessage: (message: unknown) => void,
    private readonly onStatus: (status: LspSessionStatus, error?: string) => void,
  ) {}

  async start(): Promise<void> {
    if (this.disposed) return;
    this.onStatus("starting");

    const projectRoot = getProjectFsPath(this.projectLocation);
    let spawned = false;

    for (const candidate of this.config.commands) {
      try {
        const isWsl = this.projectLocation.kind === "wsl";

        let proc: ChildProcess;
        if (isWsl) {
          const wslCmd = resolveWslCommand(candidate.command, this.projectLocation.linuxPath);
          // Route through the user's actual login shell (bash / zsh / fish /
          // whatever their passwd entry says) so nvm / fnm / user PATH is
          // sourced — otherwise `typescript-language-server` et al. installed
          // via nvm are invisible.
          const shellPath = resolveWslShellPath(this.projectLocation.distro);
          const shellCmd = [wslCmd, ...candidate.args].map(quotePosixShellArg).join(" ");
          proc = spawn(
            "wsl.exe",
            [
              "-d",
              this.projectLocation.distro,
              "--cd",
              this.projectLocation.linuxPath,
              "--",
              shellPath,
              "-l",
              "-c",
              `exec ${shellCmd}`,
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
          );
        } else {
          const cmd = resolveNativeCommand(candidate.command, projectRoot);
          proc = spawn(cmd, candidate.args, {
            cwd: projectRoot,
            stdio: ["pipe", "pipe", "pipe"],
          });
        }

        // Wait briefly to see if the process crashes immediately
        const earlyExit = await Promise.race([
          new Promise<boolean>((res) => {
            proc.on("error", () => res(true));
            proc.on("exit", () => res(true));
          }),
          new Promise<boolean>((res) => setTimeout(() => res(false), 200)),
        ]);

        if (earlyExit) {
          terminateChildProcessTree(proc);
          continue;
        }

        this.process = proc;
        spawned = true;
        break;
      } catch {
        continue;
      }
    }

    if (!spawned || !this.process?.stdout || !this.process?.stdin) {
      this.onStatus(
        "error",
        `No language server found for "${this.config.languageId}". Install one of: ${this.config.commands.map((c) => c.command).join(", ")}`,
      );
      return;
    }

    // Set up JSON-RPC connection over stdio
    const connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );

    // Forward all messages from server to renderer
    connection.onNotification((method, params) => {
      this.onMessage({
        jsonrpc: "2.0",
        method,
        params,
      });
    });

    connection.onError(([error]) => {
      console.error(`[LSP ${this.sessionId}] Connection error:`, error);
    });

    connection.listen();
    this.connection = connection;

    // Send LSP initialize request
    try {
      const rootUri = getRootUri(this.projectLocation);
      await connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            completion: {
              dynamicRegistration: false,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ["markdown", "plaintext"],
                deprecatedSupport: true,
                preselectSupport: true,
                labelDetailsSupport: true,
              },
              contextSupport: true,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ["markdown", "plaintext"],
            },
            signatureHelp: {
              dynamicRegistration: false,
              signatureInformation: {
                documentationFormat: ["markdown", "plaintext"],
                parameterInformation: { labelOffsetSupport: true },
              },
            },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
            },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        workspaceFolders: [
          {
            uri: rootUri,
            name:
              this.projectLocation.kind === "wsl"
                ? this.projectLocation.linuxPath
                : this.projectLocation.path,
          },
        ],
        ...(this.config.initializationOptions
          ? { initializationOptions: this.config.initializationOptions }
          : {}),
      });

      connection.sendNotification("initialized", {});
      this.onStatus("ready");
    } catch (error) {
      this.onStatus("error", error instanceof Error ? error.message : String(error));
      this.dispose();
      return;
    }

    // Handle process exit — attempt restart
    this.process.on("exit", (code) => {
      if (this.disposed) return;
      console.warn(`[LSP ${this.sessionId}] Server exited with code ${code}`);
      this.connection = null;
      this.process = null;

      if (this.restartCount < 3) {
        this.restartCount++;
        const delay = Math.min(1000 * 2 ** this.restartCount, 10000);
        setTimeout(() => {
          if (!this.disposed) void this.start();
        }, delay);
      } else {
        this.onStatus("error", "Language server crashed too many times");
      }
    });
  }

  /** Forward a raw JSON-RPC message from the renderer to the language server. */
  async sendMessage(message: unknown): Promise<unknown> {
    if (!this.connection) return undefined;

    const msg = message as { method?: string; id?: number; params?: unknown };
    if (!msg.method) return undefined;

    if (msg.id !== undefined) {
      // It's a request — send and return the response
      return this.connection.sendRequest(msg.method, msg.params);
    }
    // It's a notification — fire and forget
    this.connection.sendNotification(msg.method, msg.params);
    return undefined;
  }

  dispose(): void {
    this.disposed = true;
    if (this.connection) {
      try {
        this.connection
          .sendRequest("shutdown")
          .then(() => {
            this.connection?.sendNotification("exit");
            this.connection?.dispose();
          })
          .catch(() => {
            this.connection?.dispose();
          });
      } catch {
        this.connection.dispose();
      }
      this.connection = null;
    }
    if (this.process) {
      terminateChildProcessTree(this.process);
      this.process = null;
    }
    this.onStatus("stopped");
  }
}
