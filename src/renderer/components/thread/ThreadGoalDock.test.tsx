import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import { ThreadGoalDock } from "./ThreadGoalDock";

describe("ThreadGoalDock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders goal details with the shared dock chrome", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:10Z"));
    const onDismiss = vi.fn<() => void>();

    render(
      <AppProvider>
        <ThreadGoalDock
          state={{
            sourceItemId: "goal-1",
            itemState: "completed",
            objective: "Ship goal dock",
            status: "active",
            action: "set",
            tokenBudget: 1000,
            tokensUsed: 120,
            timeUsedSeconds: 5,
            updatedAt: Date.parse("2026-05-12T10:00:10Z") / 1000,
          }}
          onDismiss={onDismiss}
        />
      </AppProvider>,
    );

    expect(screen.getByLabelText("Thread goal dock")).toHaveAttribute("data-placement", "composer");
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("Ship goal dock")).toBeInTheDocument();
    expect(screen.getByText("120/1000 tokens · 5s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close goal" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("abbreviates five-digit token counts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:10Z"));

    render(
      <AppProvider>
        <ThreadGoalDock
          state={{
            sourceItemId: "goal-1",
            itemState: "completed",
            objective: "Ship goal dock",
            status: "complete",
            action: "updated",
            tokenBudget: null,
            tokensUsed: 11_199,
            timeUsedSeconds: 621,
            updatedAt: Date.parse("2026-05-12T10:00:10Z") / 1000,
          }}
          onDismiss={() => undefined}
        />
      </AppProvider>,
    );

    expect(screen.getByText("Complete · 11k tokens · 10m 21s")).toBeInTheDocument();
  });

  it("advances active goal elapsed time locally between server updates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:10Z"));

    render(
      <AppProvider>
        <ThreadGoalDock
          state={{
            sourceItemId: "goal-1",
            itemState: "completed",
            objective: "Ship goal dock",
            status: "active",
            action: "updated",
            timeUsedSeconds: 10,
            updatedAt: Date.parse("2026-05-12T10:00:10Z") / 1000,
          }}
          onDismiss={() => undefined}
        />
      </AppProvider>,
    );

    expect(screen.getByText("10s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("13s")).toBeInTheDocument();
  });
});
