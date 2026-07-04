import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { browserMcpServer } from "./composerMcpServers";

describe("ComposerAddMenu", () => {
  it("hides the file picker action when file attachments are unavailable", () => {
    render(
      <ComposerAddMenu
        mcpServers={[
          {
            descriptor: browserMcpServer,
            enabled: false,
            visible: true,
            onToggle: vi.fn<(next: boolean) => void>(),
          },
        ]}
        showFileOption={false}
        onPickFiles={vi.fn<() => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add attachment or capability" }));

    expect(screen.queryByText("File")).not.toBeInTheDocument();
    expect(screen.getByText("Browser")).toBeInTheDocument();
  });

  it("renders nothing when no add actions are available", () => {
    const { container } = render(
      <ComposerAddMenu mcpServers={[]} showFileOption={false} onPickFiles={vi.fn<() => void>()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
