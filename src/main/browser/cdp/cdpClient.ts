import type { WebContents } from "electron";

type CdpEventHandler = (params: unknown) => void;

export class CdpClient {
  private attached = false;
  private listeners = new Map<string, Set<CdpEventHandler>>();
  private rawListener: ((event: Electron.Event, method: string, params: unknown) => void) | null =
    null;

  constructor(private readonly wc: WebContents) {}

  async attach(): Promise<void> {
    if (this.attached || this.wc.isDestroyed()) return;
    try {
      this.wc.debugger.attach("1.3");
      this.attached = true;
      this.wc.debugger.on("detach", () => {
        this.attached = false;
      });
      this.installRawListener();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (!/already attached/i.test(msg)) {
        throw err;
      }
      this.attached = true;
      this.installRawListener();
    }
  }

  private installRawListener(): void {
    if (this.rawListener || this.wc.isDestroyed()) return;
    const handler = (_event: Electron.Event, method: string, params: unknown) => {
      const set = this.listeners.get(method);
      if (!set) return;
      for (const h of set) {
        try {
          h(params);
        } catch {}
      }
    };
    this.rawListener = handler;
    try {
      this.wc.debugger.on("message", handler);
    } catch {}
  }

  detach(): void {
    if (!this.attached || this.wc.isDestroyed()) return;
    try {
      this.wc.debugger.detach();
    } catch {}
    this.attached = false;
    this.listeners.clear();
    this.rawListener = null;
  }

  isAttached(): boolean {
    return this.attached && !this.wc.isDestroyed();
  }

  async send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult> {
    if (!this.attached) {
      await this.attach();
    }
    return (await this.wc.debugger.sendCommand(method, params ?? {})) as TResult;
  }

  on(method: string, handler: CdpEventHandler): () => void {
    let set = this.listeners.get(method);
    if (!set) {
      set = new Set();
      this.listeners.set(method, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.listeners.delete(method);
      }
    };
  }
}
