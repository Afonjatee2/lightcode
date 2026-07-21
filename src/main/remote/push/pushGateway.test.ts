import { describe, expect, it, vi } from "vitest";
import {
  createPushGateway,
  createWebPushPublicKeyResolver,
  type CreatePushGatewayOptions,
} from "./pushGateway";

type GatewayFetch = NonNullable<CreatePushGatewayOptions["fetchImpl"]>;

describe("push gateway client", () => {
  it("sends a Web Push subscription without a native token", async () => {
    let body: Record<string, unknown> = {};
    const send = createPushGateway({
      gatewayUrl: "https://gateway.example.test",
      fetchImpl: vi.fn<GatewayFetch>(async (_url, init) => {
        body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return { ok: false, status: 404 };
      }),
    });

    await expect(
      send({
        platform: "web",
        pushType: "alert",
        subscription: {
          endpoint: "https://web.push.apple.com/subscription-1",
          expirationTime: null,
          keys: { p256dh: "key", auth: "auth" },
        },
        payload: { title: "Thread", body: "Finished", threadId: "t1", url: "/thread/t1" },
      }),
    ).resolves.toMatchObject({ status: 404, unregistered: true });

    expect(body).toMatchObject({
      platform: "web",
      subscription: { endpoint: "https://web.push.apple.com/subscription-1" },
    });
    expect(body).not.toHaveProperty("token");
  });

  it("resolves the gateway VAPID public key", async () => {
    const resolve = createWebPushPublicKeyResolver({
      gatewayUrl: "https://gateway.example.test",
      fetchImpl: vi.fn<GatewayFetch>(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ publicKey: "vapid-key" }),
      })),
    });

    await expect(resolve()).resolves.toBe("vapid-key");
  });
});
