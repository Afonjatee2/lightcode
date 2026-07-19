// Vercel build entry for the hosted PWA. Production deployments build under
// /app/ (served as poracode.com/app via the landing project's rewrites);
// preview deployments — the auto-deployed nightly channel — build under
// /app-nightly/ so both channels can live on the same origin without
// colliding assets or service-worker scopes (see mobileServiceWorkerScope in
// src/mobile/routing.ts).
import { spawnSync } from "node:child_process";

const basePath = process.env.VERCEL_ENV === "preview" ? "/app-nightly/" : "/app/";
console.log(`[vercel-build-mobile] VERCEL_ENV=${process.env.VERCEL_ENV} base=${basePath}`);

const result = spawnSync("pnpm", ["run", "build:mobile"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORACODE_MOBILE_BASE_PATH: basePath,
    npm_config_enable_global_virtual_store: "false",
    npm_config_node_linker: "isolated",
    pnpm_config_verify_deps_before_run: "false",
  },
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
