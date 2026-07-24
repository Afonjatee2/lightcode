import { describe, expect, it } from "vitest";
import { parseMention } from "./parser";

describe("mention parser — provider aliases", () => {
  it("@codex with instruction", () => {
    const r = parseMention("@codex check the budget pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
    expect(r.requestedProvider).toBe("codex");
    expect(r.consultationMode).toBe("standard");
    expect(r.instruction).toBe("check the budget pacing");
  });

  it("@claude with instruction", () => {
    const r = parseMention("@claude review channel mix");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
    expect(r.requestedProvider).toBe("claude");
  });

  it("@kimi with instruction", () => {
    const r = parseMention("@kimi analyse the figures");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("kimi");
  });

  it("@qwen with instruction", () => {
    const r = parseMention("@qwen summarise alerts");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("qwen");
  });

  it("@deepseek with instruction", () => {
    const r = parseMention("@deepseek research the KPI trends");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("deepseek");
  });
});

describe("mention parser — role aliases", () => {
  it("@daily-operator (hyphen)", () => {
    const r = parseMention("@daily-operator check pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
    expect(r.consultationMode).toBe("standard");
    expect(r.instruction).toBe("check pacing");
  });

  it("@daily_operator (underscore)", () => {
    const r = parseMention("@daily_operator check pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
  });

  it("@strategic-reviewer (hyphen)", () => {
    const r = parseMention("@strategic-reviewer evaluate channels");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("strategic_reviewer");
  });

  it("@strategic_reviewer (underscore)", () => {
    const r = parseMention("@strategic_reviewer evaluate channels");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("strategic_reviewer");
  });

  it("@figures-auditor (hyphen)", () => {
    const r = parseMention("@figures-auditor verify spend");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("figures_auditor");
  });

  it("@figures_auditor (underscore)", () => {
    const r = parseMention("@figures_auditor verify spend");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("figures_auditor");
  });
});

describe("mention parser — command aliases", () => {
  it("@verify resolves to verifier role + standard mode", () => {
    const r = parseMention("@verify the pacing numbers");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("verifier");
    expect(r.consultationMode).toBe("standard");
    expect(r.commandToken).toBe("verify");
  });

  it("@challenge resolves to challenger role + standard mode", () => {
    const r = parseMention("@challenge the budget split");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("challenger");
    expect(r.commandToken).toBe("challenge");
  });

  it("@research resolves to researcher role + standard mode", () => {
    const r = parseMention("@research competitor CPMs");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("researcher");
    expect(r.commandToken).toBe("research");
  });

  it("@panel resolves to panel role + panel mode", () => {
    const r = parseMention("@panel review the Q3 performance");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("panel");
    expect(r.consultationMode).toBe("panel");
  });

  it("@finalise resolves to finaliser role + finalise mode", () => {
    const r = parseMention("@finalise the campaign review");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("finaliser");
    expect(r.consultationMode).toBe("finalise");
  });

  it("@handoff resolves to handoff_writer role + standard mode", () => {
    const r = parseMention("@handoff draft the client summary");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("handoff_writer");
    expect(r.commandToken).toBe("handoff");
  });
});

describe("mention parser — case insensitivity", () => {
  it("@CODEX uppercase", () => {
    const r = parseMention("@CODEX check budget");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("codex");
  });

  it("@Verify mixed case", () => {
    const r = parseMention("@Verify the spend");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("verifier");
  });

  it("@Daily-Operator mixed case", () => {
    const r = parseMention("@Daily-Operator check pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
  });
});

describe("mention parser — provider + role combination", () => {
  it("provider before role", () => {
    const r = parseMention("@codex @daily-operator check pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("codex");
    expect(r.resolvedRole).toBe("daily_operator");
  });

  it("role before provider", () => {
    const r = parseMention("@daily-operator @claude check pacing");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("claude");
    expect(r.resolvedRole).toBe("daily_operator");
  });
});

describe("mention parser — provider + command combination", () => {
  it("@codex @verify the figures", () => {
    const r = parseMention("@codex @verify the figures");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("codex");
    expect(r.resolvedRole).toBe("verifier");
  });

  it("@challenge @deepseek the assumptions", () => {
    const r = parseMention("@challenge @deepseek the assumptions");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("deepseek");
    expect(r.resolvedRole).toBe("challenger");
  });
});

describe("mention parser — email avoidance", () => {
  it("name@claude.com is not a mention", () => {
    const r = parseMention("name@claude.com check budget");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });

  it("user@codex.dev is not a mention", () => {
    const r = parseMention("user@codex.dev review this");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });

  it("email in sentence", () => {
    const r = parseMention("contact admin@claude.com for help");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });
});

describe("mention parser — code block avoidance", () => {
  it("mention inside backtick block is ignored", () => {
    const r = parseMention("```\n@codex check buffer\n```\nreal instruction");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });

  it("mention inside inline code is ignored", () => {
    const r = parseMention("use `@codex review` to start");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });

  it("mention outside code block still works", () => {
    const r = parseMention("```\nsome code\n```\n@codex review the budget");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.requestedProvider).toBe("codex");
    expect(r.instruction).toBe("review the budget");
  });
});

describe("mention parser — quoted text avoidance", () => {
  it("> quoted mention is ignored", () => {
    const r = parseMention("> @codex old review\n@codex new review");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.instruction).toBe("new review");
  });

  it("> prefix with space is ignored", () => {
    const r = parseMention("> @codex prior analysis ignored here");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });
});

describe("mention parser — error: unknown mention", () => {
  it("@unknown_alias is unknown", () => {
    const r = parseMention("@unknown_alias do something");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });

  it("@gibberish is unknown", () => {
    const r = parseMention("@gibberish act");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("unknown_mention");
  });
});

describe("mention parser — error: missing instruction", () => {
  it("@codex alone", () => {
    const r = parseMention("@codex");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("missing_instruction");
    expect(r.token).toBe("codex");
  });

  it("@daily-operator alone", () => {
    const r = parseMention("@daily-operator");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("missing_instruction");
  });

  it("@verify alone", () => {
    const r = parseMention("@verify");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("missing_instruction");
  });

  it("empty input", () => {
    const r = parseMention("");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("missing_instruction");
  });
});

describe("mention parser — error: ambiguous mention", () => {
  it("two different providers", () => {
    const r = parseMention("@codex @claude check budget");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("ambiguous_mention");
  });

  it("two different roles", () => {
    const r = parseMention("@daily-operator @figures-auditor review");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("ambiguous_mention");
  });

  it("two different commands", () => {
    const r = parseMention("@verify @challenge the pacing");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.code).toBe("ambiguous_mention");
  });
});

describe("mention parser — precedence rules", () => {
  it("command wins over role for role+mode resolution", () => {
    const r = parseMention("@verify @daily-operator check the spend");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("verifier");
    expect(r.commandToken).toBe("verify");
  });

  it("provider-only defaults to daily_operator", () => {
    const r = parseMention("@codex analyse the budget");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
    expect(r.requestedProvider).toBe("codex");
  });

  it("provider-only defaults to daily_operator role", () => {
    const r = parseMention("@qwen research competitor CPMs");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.resolvedRole).toBe("daily_operator");
    expect(r.requestedProvider).toBe("qwen");
  });
});

describe("mention parser — instruction extraction", () => {
  it("preserves original case in instruction", () => {
    const r = parseMention("@codex Check the CPC for Meta Ads");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.instruction).toBe("Check the CPC for Meta Ads");
  });

  it("trims whitespace around instruction", () => {
    const r = parseMention("@codex   review budget    ");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.instruction).toBe("review budget");
  });

  it("multi-word instruction", () => {
    const r = parseMention("@daily-operator check if any alerts are open and report back");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.instruction).toBe("check if any alerts are open and report back");
  });
});

describe("mention parser — originalMention round-trip", () => {
  it("captures original mention text", () => {
    const r = parseMention("@codex @verify the CTR is dropping");
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.originalMention).toBe("@codex @verify the CTR is dropping");
  });
});
