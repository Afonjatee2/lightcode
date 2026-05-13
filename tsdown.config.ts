import { defineConfig } from "tsdown";

const isProd = process.env.NODE_ENV === "production";
const sourcemap = isProd ? ("hidden" as const) : true;

function readEnvValue(key: string): string {
  return (process.env[key] ?? "").trim();
}

const buildDefines = {
  __BUILD_SENTRY_DSN__: JSON.stringify(readEnvValue("SENTRY_DSN")),
  __BUILD_SENTRY_ENVIRONMENT__: JSON.stringify(readEnvValue("SENTRY_ENVIRONMENT")),
};

const deps = {
  alwaysBundle: ["electron-updater", "simple-git", "zod"],
  onlyBundle: false as const,
  neverBundle: [
    "electron",
    "node-pty",
    "better-sqlite3",
    "@anthropic-ai/claude-agent-sdk",
    "@opencode-ai/sdk",
  ],
};

const shared = {
  outDir: "dist/main",
  platform: "node" as const,
  format: "cjs" as const,
  target: "node24" as const,
  sourcemap,
  dts: false,
  minify: isProd ? ({ compress: { dropConsole: true, dropDebugger: true } } as const) : false,
  define: buildDefines,
  deps,
};

export default defineConfig([
  {
    entry: { main: "src/main/main.ts" },
    clean: true,
    ...shared,
  },
  {
    entry: { preload: "src/main/preload.ts" },
    clean: false,
    ...shared,
  },
  {
    entry: { supervisor: "src/supervisor/index.ts" },
    clean: false,
    ...shared,
  },
  {
    entry: { claudeSdkProbeWorker: "src/supervisor/agents/claude/sdkProbeWorker.ts" },
    clean: false,
    outDir: "dist/main",
    platform: "node" as const,
    format: "esm" as const,
    target: "node24" as const,
    sourcemap,
    dts: false,
    minify: false,
    define: buildDefines,
    deps,
  },
]);
