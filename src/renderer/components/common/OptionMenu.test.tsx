import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionMenu } from "./OptionMenu";

describe("OptionMenu", () => {
  it("defers menu item rendering until opened", async () => {
    const onChange = vi.fn<(value: string) => void>();

    render(
      <OptionMenu
        value="a"
        options={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.queryByText("Beta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    fireEvent.click(await screen.findByText("Beta"));

    expect(onChange).toHaveBeenCalledWith("b");
  });
});
