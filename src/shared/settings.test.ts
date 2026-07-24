import { describe, expect, it } from "vitest";
import { defaultSharedSettings } from "./settings";

describe("shared settings defaults", () => {
  it("enables notifications and displays them for visible threads by default", () => {
    expect(defaultSharedSettings.notificationsEnabled).toBe(true);
    expect(defaultSharedSettings.remotePushEnabled).toBe(true);
    expect(defaultSharedSettings.notificationFilter).toBe("all");
  });
});
