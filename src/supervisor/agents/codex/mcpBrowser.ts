import {
  BROWSER_MCP_SERVER_NAME,
  resolveBrowserMcpHttpConfig,
  type BrowserMcpLocation,
} from "@/supervisor/agents/browserMcp";

/**
 * Codex CLI accepts inline TOML overrides via `-c key.path=value`. Build the
 * override sequence registering the Lightcode in-app browser MCP server for a
 * single Codex invocation, using Codex's streamable-HTTP MCP transport.
 *
 * Codex enables the rmcp client (which speaks streamable HTTP + SSE) when
 * `experimental_use_rmcp_client = true`. For older Codex builds that don't
 * recognize the flag, the override is harmlessly ignored.
 *
 * Codex streamable-HTTP config reads bearer tokens from an env var; passing
 * the token literal as `bearer_token` makes current Codex builds reject the
 * whole config.
 *
 * Returns an empty array if MCP is disabled.
 */
export function buildCodexBrowserMcpArgs(location: BrowserMcpLocation): string[] {
  const cfg = resolveBrowserMcpHttpConfig(location);
  if (!cfg) return [];

  const name = BROWSER_MCP_SERVER_NAME;

  return [
    "-c",
    `experimental_use_rmcp_client=true`,
    "-c",
    `mcp_servers.${name}.url=${JSON.stringify(cfg.url)}`,
    "-c",
    `mcp_servers.${name}.bearer_token_env_var="LIGHTCODE_BROWSER_MCP_TOKEN"`,
  ];
}
