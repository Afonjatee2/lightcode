import { describe, it, expect } from "vitest";
import { extractOscEvents, extractOscEventsFromPtyStream } from "./osc";

describe("extractOscEvents", () => {
  it("returns empty arrays and unchanged data when no OSC sequences present", () => {
    const data = "hello world\x1b[32mgreen text\x1b[0m";
    const result = extractOscEvents(data);
    expect(result.notifications).toEqual([]);
    expect(result.titles).toEqual([]);
    expect(result.cleaned).toBe(data);
  });

  // ── OSC 9 ──────────────────────────────────────────────

  describe("OSC 9 (simple notify)", () => {
    it("extracts OSC 9 with BEL terminator", () => {
      const data = "before\x1b]9;Build complete\x07after";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]).toEqual({
        code: 9,
        title: "",
        body: "Build complete",
        payload: undefined,
      });
      expect(result.cleaned).toBe("beforeafter");
    });

    it("extracts OSC 9 with ST (ESC \\) terminator", () => {
      const data = "\x1b]9;Done\x1b\\rest";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.code).toBe(9);
      expect(result.notifications[0]!.body).toBe("Done");
      expect(result.cleaned).toBe("rest");
    });

    it("parses JSON body in OSC 9", () => {
      const json = '{"event":"stop","agent":"claude"}';
      const data = `\x1b]9;${json}\x07`;
      const result = extractOscEvents(data);
      expect(result.notifications[0]!.payload).toEqual({
        event: "stop",
        agent: "claude",
      });
    });
  });

  // ── OSC 777 ────────────────────────────────────────────

  describe("OSC 777 (RXVT notify)", () => {
    it("extracts OSC 777 with title and body", () => {
      const data = "\x1b]777;notify;Claude Code;Session complete\x07";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]).toEqual({
        code: 777,
        title: "Claude Code",
        body: "Session complete",
        payload: undefined,
      });
      expect(result.cleaned).toBe("");
    });

    it("extracts OSC 777 with JSON body", () => {
      const json = '{"event":"idle_prompt","agent":"claude","v":1}';
      const data = `prefix\x1b]777;notify;warp://cli-agent;${json}\x07suffix`;
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.title).toBe("warp://cli-agent");
      expect(result.notifications[0]!.payload).toEqual({
        event: "idle_prompt",
        agent: "claude",
        v: 1,
      });
      expect(result.cleaned).toBe("prefixsuffix");
    });

    it("extracts OSC 777 with ST terminator", () => {
      const data = "\x1b]777;notify;Title;Body\x1b\\";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.code).toBe(777);
      expect(result.notifications[0]!.title).toBe("Title");
      expect(result.notifications[0]!.body).toBe("Body");
    });

    it("handles empty body in OSC 777", () => {
      const data = "\x1b]777;notify;Alert;\x07";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.body).toBe("");
    });
  });

  // ── OSC 99 ─────────────────────────────────────────────

  describe("OSC 99 (Kitty notify)", () => {
    it("extracts title payload", () => {
      const data = "\x1b]99;i=1;e=1;d=0;p=title:Build Complete\x1b\\";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]).toEqual({
        code: 99,
        title: "Build Complete",
        body: "",
        payload: undefined,
      });
    });

    it("extracts body payload", () => {
      const data = "\x1b]99;i=1;d=1;p=body:All tests passed\x07";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.title).toBe("");
      expect(result.notifications[0]!.body).toBe("All tests passed");
    });

    it("handles subtitle as body", () => {
      const data = "\x1b]99;i=1;p=subtitle:Project X\x07";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.body).toBe("Project X");
    });
  });

  // ── OSC 0 / 1 / 2 — window/icon title ─────────────────

  describe("OSC 0/1/2 (window/icon title)", () => {
    it("extracts OSC 0 title with BEL terminator", () => {
      const data = "before\x1b]0;My Window Title\x07after";
      const result = extractOscEvents(data);
      expect(result.titles).toEqual([{ code: 0, text: "My Window Title" }]);
      expect(result.notifications).toEqual([]);
      expect(result.cleaned).toBe("beforeafter");
    });

    it("extracts OSC 2 title with ST terminator", () => {
      const data = "\x1b]2;Pure window title\x1b\\";
      const result = extractOscEvents(data);
      expect(result.titles).toEqual([{ code: 2, text: "Pure window title" }]);
      expect(result.cleaned).toBe("");
    });

    it("extracts OSC 1 icon name", () => {
      const data = "\x1b]1;IconName\x07";
      const result = extractOscEvents(data);
      expect(result.titles).toEqual([{ code: 1, text: "IconName" }]);
    });

    it("extracts Claude-style braille-spinner title", () => {
      const data = "\x1b]0;⠂ Add jump to bottom button\x07";
      const result = extractOscEvents(data);
      expect(result.titles).toHaveLength(1);
      expect(result.titles[0]!.text).toBe("⠂ Add jump to bottom button");
    });

    it("extracts multiple titles from one chunk", () => {
      const data = "\x1b]0;first\x07middle\x1b]0;second\x07";
      const result = extractOscEvents(data);
      expect(result.titles.map((t) => t.text)).toEqual(["first", "second"]);
      expect(result.cleaned).toBe("middle");
    });

    it("does NOT match OSC 7 (cwd) or OSC 133 (prompt marking)", () => {
      const data = "\x1b]7;file:///home\x07\x1b]133;A\x07";
      const result = extractOscEvents(data);
      expect(result.titles).toEqual([]);
      expect(result.notifications).toEqual([]);
      expect(result.cleaned).toBe(data);
    });

    it("does NOT match multi-digit codes that start with 0/1/2 (11, 133, 1337)", () => {
      const data = "\x1b]11;rgb:ff/ff/ff\x07\x1b]133;A\x07\x1b]1337;something\x07";
      const result = extractOscEvents(data);
      expect(result.titles).toEqual([]);
      expect(result.cleaned).toBe(data);
    });
  });

  // ── Multiple notifications ────────────────────────────

  describe("multiple notifications", () => {
    it("extracts multiple OSC sequences from a single data chunk", () => {
      const data = "line1\x1b]777;notify;A;First\x07line2\x1b]9;Second\x07line3";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(2);
      expect(result.notifications[0]!.code).toBe(777);
      expect(result.notifications[0]!.body).toBe("First");
      expect(result.notifications[1]!.code).toBe(9);
      expect(result.notifications[1]!.body).toBe("Second");
      expect(result.cleaned).toBe("line1line2line3");
    });

    it("interleaves titles and notifications", () => {
      const data = "\x1b]0;Title A\x07mid\x1b]9;Notify\x07\x1b]0;Title B\x07";
      const result = extractOscEvents(data);
      expect(result.titles.map((t) => t.text)).toEqual(["Title A", "Title B"]);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.body).toBe("Notify");
      expect(result.cleaned).toBe("mid");
    });
  });

  // ── Edge cases ────────────────────────────────────────

  describe("edge cases", () => {
    it("handles malformed JSON body gracefully", () => {
      const data = "\x1b]777;notify;Title;{broken json\x07";
      const result = extractOscEvents(data);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]!.body).toBe("{broken json");
      expect(result.notifications[0]!.payload).toBeUndefined();
    });

    it("handles empty data", () => {
      const result = extractOscEvents("");
      expect(result.notifications).toEqual([]);
      expect(result.titles).toEqual([]);
      expect(result.cleaned).toBe("");
    });

    it("reconstructs OSC 9 split across two PTY chunks (carry buffer)", () => {
      const a = "before\x1b]9;agent-tur";
      const b = "n-complete\x07after";
      const r1 = extractOscEventsFromPtyStream("", a);
      expect(r1.notifications).toEqual([]);
      expect(r1.carryOut.startsWith("\x1b]9;")).toBe(true);
      const r2 = extractOscEventsFromPtyStream(r1.carryOut, b);
      expect(r2.notifications).toHaveLength(1);
      expect(r2.notifications[0]!.code).toBe(9);
      expect(r2.notifications[0]!.body).toBe("agent-turn-complete");
      expect(r1.cleaned + r2.cleaned).toBe("beforeafter");
    });

    it("reconstructs OSC 0 title split across two PTY chunks", () => {
      const a = "before\x1b]0;⠂ Add jump to";
      const b = " bottom\x07after";
      const r1 = extractOscEventsFromPtyStream("", a);
      expect(r1.titles).toEqual([]);
      expect(r1.carryOut.startsWith("\x1b]0;")).toBe(true);
      const r2 = extractOscEventsFromPtyStream(r1.carryOut, b);
      expect(r2.titles).toHaveLength(1);
      expect(r2.titles[0]!.text).toBe("⠂ Add jump to bottom");
      expect(r1.cleaned + r2.cleaned).toBe("beforeafter");
    });

    it("does not parse JSON arrays as payload", () => {
      const data = "\x1b]777;notify;T;[1,2,3]\x07";
      const result = extractOscEvents(data);
      expect(result.notifications[0]!.payload).toBeUndefined();
    });
  });
});
