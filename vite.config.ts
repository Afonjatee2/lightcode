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
              name: "vendor",
              test: /[\\/]node_modules[\\/]/,
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
