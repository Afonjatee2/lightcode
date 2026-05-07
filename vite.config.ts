import { resolve } from "node:path";
import { defineConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";

const compilerPreset = reactCompilerPreset();

export default defineConfig({
  plugins: [react(), babel({ presets: [compilerPreset] })],
  base: "./",
  resolve: {
    tsconfigPaths: true,
    alias: {
      "~file-icons": resolve(__dirname, "node_modules/material-icon-theme/icons"),
    },
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    // Filter modulePreload so the heaviest async chunks (shiki grammars,
    // @git-diff-view, xterm) are not parsed by V8 at startup. They load on
    // demand when the code path that needs them runs (first code block,
    // first git overlay open, first terminal).
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/(?:^|\/)(shiki-|git-diff-|xterm-|vendor-)/.test(dep)),
    },
    rolldownOptions: {
      output: {
        minify: {
          compress: {
            dropConsole: true,
            dropDebugger: true,
          },
        },
        codeSplitting: {
          groups: [
            {
              name: "xterm",
              test: /[\\/]node_modules[\\/]@xterm[\\/]/,
              priority: 50,
            },
            {
              name: "git-diff",
              test: /[\\/]node_modules[\\/]@git-diff-view[\\/]/,
              priority: 45,
            },
            {
              name: "monaco",
              test: /[\\/]node_modules[\\/](@monaco-editor|monaco-editor)[\\/]/,
              priority: 40,
            },
            {
              // Shiki engine + bundle-full glue, BUT not its grammars/themes.
              // shiki/bundle-full uses per-language dynamic imports
              // (`() => import("@shikijs/langs/typescript")`); leaving
              // langs/themes out of any group lets rolldown emit them as
              // separate per-language chunks, so V8 only parses the grammars
              // actually rendered.
              name: "shiki",
              test: /[\\/]node_modules[\\/](shiki[\\/]|@shikijs[\\/](?:core|engine-|types|vscode-))/,
              priority: 38,
            },
            {
              name: "ui",
              test: /[\\/]node_modules[\\/](@heroui|react-aria|@react-stately|@react-types|tailwind-merge|tailwind-variants)[\\/]/,
              priority: 35,
            },
            {
              name: "framework",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand|zod)[\\/]/,
              priority: 30,
            },
            {
              // Catch-all for everything not handled above. Excludes
              // @shikijs/langs and @shikijs/themes so each grammar/theme
              // becomes its own auto-chunk (one per file actually used).
              name: "vendor",
              test: (id: string) =>
                /[\\/]node_modules[\\/]/.test(id) &&
                !/[\\/]@shikijs[\\/](?:langs|themes)[\\/]/.test(id),
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    forwardConsole: true,
    host: "127.0.0.1",
    port: 3100,
    strictPort: true,
  },
});
