import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/renderer/components/ui/provider";
import ItemMarkdownInner from "./ItemMarkdownInner";

const { codeBlockSpy } = vi.hoisted(() => ({
  codeBlockSpy:
    vi.fn<(props: { text: string; lang: string; className: string | undefined }) => void>(),
}));

vi.mock("./CodeBlock", () => ({
  CodeBlock: ({ text, lang, className }: { text: string; lang: string; className?: string }) => {
    codeBlockSpy({ text, lang, className });
    return (
      <div data-testid="code-block" data-lang={lang} className={className}>
        {text}
      </div>
    );
  },
}));

describe("ItemMarkdownInner", () => {
  beforeEach(() => {
    codeBlockSpy.mockClear();
  });

  it("routes supported fenced code blocks through CodeBlock", () => {
    render(
      <AppProvider>
        <ItemMarkdownInner
          text={"```css\n.animate-tool-call-enter {\n  animation: fade-in;\n}\n```"}
        />
      </AppProvider>,
    );

    expect(screen.getByTestId("code-block")).toHaveAttribute("data-lang", "css");
    expect(codeBlockSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ".animate-tool-call-enter {\n  animation: fade-in;\n}",
        lang: "css",
        className: expect.stringContaining("not-prose"),
      }),
    );
  });

  it("keeps inline code on the inline code path", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"Use `const value = 1` in the snippet."} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("code")).toHaveTextContent("const value = 1");
  });

  it("falls back to a plain pre/code block for language-less fences", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"```\nplain block\n```"} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("pre > code")).toHaveTextContent("plain block");
  });

  it("falls back to a plain pre/code block for unsupported fence languages", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"```text\nplain block\n```"} />
      </AppProvider>,
    );

    expect(screen.queryByTestId("code-block")).not.toBeInTheDocument();
    expect(container.querySelector("pre > code")).toHaveTextContent("plain block");
  });

  it("renders single newlines as line breaks", () => {
    const { container } = render(
      <AppProvider>
        <ItemMarkdownInner text={"line 1\nline 2"} />
      </AppProvider>,
    );

    expect(container.querySelector("p")?.textContent).toBe("line 1\nline 2");
  });
});
