import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { GoalItem } from "./GoalItem";

describe("GoalItem", () => {
  it("renders an active goal summary", () => {
    render(
      <AppProvider>
        <GoalItem
          item={makeGoalItem({
            action: "set",
            objective: "ship unified GUI goal support",
            status: "active",
            tokenBudget: 5000,
            tokensUsed: 120,
            timeUsedSeconds: 3,
          })}
        />
      </AppProvider>,
    );

    expect(screen.getByText("Goal set")).toBeInTheDocument();
    expect(screen.getByText("ship unified GUI goal support")).toBeInTheDocument();
    expect(screen.getByText("120/5000 tokens")).toBeInTheDocument();
    expect(screen.getByText("3s")).toBeInTheDocument();
  });

  it("renders a cleared goal summary", () => {
    render(
      <AppProvider>
        <GoalItem item={makeGoalItem({ action: "cleared" })} />
      </AppProvider>,
    );

    expect(screen.getByText("Goal cleared")).toBeInTheDocument();
  });
});

function makeGoalItem(payload: RuntimeChatItem["payload"]): RuntimeChatItem {
  return {
    id: "goal-1",
    type: "goal",
    state: "completed",
    payload,
    streams: {},
  };
}
