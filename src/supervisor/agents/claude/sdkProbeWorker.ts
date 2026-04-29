/**
 * Runs inside WSL (login-shell `node` invocation) to execute the Claude Agent SDK
 * with a Linux `claude` path. Prints one JSON object on stdout:
 * `{ "slashCommands": AgentSlashCommand[] }`.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";

function abortEndedUserStream(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: (): AsyncIterator<SDKUserMessage> => ({
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          if (signal.aborted) {
            resolve({ done: true, value: undefined });
            return;
          }
          signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), {
            once: true,
          });
        }),
    }),
  };
}

function mapCommands(commands: SlashCommand[]) {
  return commands.map((c) => ({
    id: c.name,
    label: c.description?.trim() ? `${c.name} — ${c.description}` : c.name,
    ...(c.description?.trim() ? { description: c.description } : {}),
    ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
  }));
}

async function main() {
  const claudePath = process.argv[2];
  const timeoutMs = Math.min(Math.max(Number(process.argv[3]) || 12_000, 3000), 60_000);

  if (!claudePath?.trim()) {
    console.error(JSON.stringify({ error: "missing_claude_path" }));
    process.exitCode = 2;
    return;
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const q = query({
      prompt: abortEndedUserStream(abort.signal),
      options: {
        abortController: abort,
        pathToClaudeCodeExecutable: claudePath,
        persistSession: false,
        cwd: "/tmp",
        settingSources: ["user", "project", "local"],
        allowedTools: [],
        stderr: () => {},
      },
    });

    const init = await q.initializationResult();
    const payload = { slashCommands: mapCommands(init.commands) };
    console.log(JSON.stringify(payload));
    try {
      q.close();
    } catch {
      // ignore
    }
    abort.abort();
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

void main();
