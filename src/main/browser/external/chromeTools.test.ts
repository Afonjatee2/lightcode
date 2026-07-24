import { describe, expect, it, vi } from "vitest";
import type { CdpSession } from "../cdp/cdpClient";
import type { ExternalChromeConnection } from "./ExternalChromeConnection";
import { dispatchChromeTool } from "./chromeTools";

describe("dispatchChromeTool", () => {
  it("hides and restores the presence cursor around external Chrome screenshots", async () => {
    const events: string[] = [];
    const cdp = {
      send: vi.fn<(method: string, params?: Record<string, unknown>) => Promise<unknown>>(
        async (method, params) => {
          if (method === "Runtime.evaluate") {
            const expression = String(params?.expression ?? "");
            if (expression.includes("depth+1")) {
              events.push("hide");
            } else {
              events.push("restore");
            }
            return { result: { type: "boolean", value: true } };
          }
          if (method === "Page.captureScreenshot") {
            events.push("capture");
            return { data: Buffer.from("screenshot").toString("base64") };
          }
          return {};
        },
      ),
    } as unknown as CdpSession;
    const connection = {
      cdpSession: () => cdp,
    } as unknown as ExternalChromeConnection;

    const result = await dispatchChromeTool(
      "chrome_screenshot",
      {},
      {
        connection,
        allowEval: false,
        allowDataAccess: false,
      },
    );

    expect(events).toEqual(["hide", "capture", "restore"]);
    expect(result).toEqual({
      __image: Buffer.from("screenshot").toString("base64"),
      mimeType: "image/jpeg",
    });
  });
});
