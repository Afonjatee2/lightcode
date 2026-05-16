import { describe, expect, it } from "vitest";
import {
  buildRuntimeDiagnosticTags,
  sanitizeSentryEvent,
  type SentryEventLike,
} from "./sentryPrivacy";

describe("sentryPrivacy", () => {
  it("keeps only allowlisted diagnostic tags", () => {
    const event = sanitizeSentryEvent({
      tags: {
        "lightcode.provider": "codex",
        "lightcode.presentation": "terminal",
        repo: "secret-repo",
        user: "someone@example.com",
      },
    });

    expect(event.tags).toEqual({
      "lightcode.provider": "codex",
      "lightcode.presentation": "terminal",
    });
  });

  it("drops user, request, extra, modules, and breadcrumbs", () => {
    const event = sanitizeSentryEvent({
      breadcrumbs: [{ message: "terminal output" }],
      extra: { prompt: "write code", token: "secret" },
      modules: { lightcode: "0.1.7" },
      request: { url: "file:///Users/alice/work/repo" },
      server_name: "alice-macbook",
      user: { id: "alice" },
    });

    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.modules).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.user).toBeUndefined();
  });

  it("scrubs paths, tokens, and frame locals while preserving stack frame shape", () => {
    const event = sanitizeSentryEvent({
      message: "Failed in /Users/alice/work/private-repo/src/app.ts token=abc123",
      exception: {
        values: [
          {
            value: "Cannot open C:\\Users\\alice\\repo\\secret.ts",
            stacktrace: {
              frames: [
                {
                  filename: "/Users/alice/work/private-repo/src/app.ts",
                  abs_path: "file:///Users/alice/work/private-repo/src/app.ts",
                  function: "runThread",
                  vars: { prompt: "private prompt" },
                  context_line: "const token = secret",
                },
              ],
            },
          },
        ],
      },
    } satisfies SentryEventLike);

    expect(event.message).toBe("Failed in [path] token=[redacted]");
    expect(event.exception?.values?.[0]?.value).toBe("Cannot open [path]");
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: "[path]",
      abs_path: "[path]",
      function: "runThread",
    });
  });

  it("preserves the lightcode context (channel, appVersion, packaged) while still dropping disallowed contexts", () => {
    const event = sanitizeSentryEvent({
      contexts: {
        lightcode: {
          appVersion: "0.9.5",
          channel: "nightly",
          packaged: true,
          process: "main",
        },
        runtime: { name: "node", version: "24.10.0" },
        session: { id: "should-be-dropped" },
      },
    } satisfies SentryEventLike);

    expect(event.contexts?.lightcode).toEqual({
      appVersion: "0.9.5",
      channel: "nightly",
      packaged: true,
      process: "main",
    });
    expect(event.contexts?.runtime).toEqual({ name: "node", version: "24.10.0" });
    expect(event.contexts?.session).toBeUndefined();
  });

  it("builds coarse runtime tags without thread or project identifiers", () => {
    expect(
      buildRuntimeDiagnosticTags({
        provider: "codex",
        presentation: "gui",
        runtimeKind: "structured",
        featureArea: "thread",
      }),
    ).toEqual({
      "lightcode.feature_area": "thread",
      "lightcode.presentation": "gui",
      "lightcode.provider": "codex",
      "lightcode.runtime_kind": "structured",
    });
  });
});
