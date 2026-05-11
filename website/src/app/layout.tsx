import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lightcode - Universal AI Agent Orchestrator",
  description:
    "The universal desktop orchestrator for AI agents. Run terminal-native and structured chat agents side-by-side.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased dark:bg-black dark:text-white min-h-screen">{children}</body>
    </html>
  );
}
