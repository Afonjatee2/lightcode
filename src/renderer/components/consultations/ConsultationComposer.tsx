import { useState, type KeyboardEvent } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  parseMention,
  PROVIDER_ALIASES,
  ROLE_ALIASES,
  COMMAND_ALIASES,
  type MentionParseResult,
} from "@/shared/consultations";
import { Button } from "@/renderer/components/common/Button";

interface ResolvedMention {
  label: string;
  provider: string | null;
  role: string;
  mode: string;
}

interface ConsultationComposerProps {
  onSubmit: (result: MentionParseResult) => void;
  disabled?: boolean;
}

export function ConsultationComposer({ onSubmit, disabled }: ConsultationComposerProps) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  const [resolved, setResolved] = useState<ResolvedMention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");

  const allMentions = [
    ...Object.entries(PROVIDER_ALIASES).map(([alias, provider]) => ({
      alias,
      label: `@${alias}`,
      kind: "provider" as const,
      detail: provider,
    })),
    ...Object.entries(ROLE_ALIASES).map(([alias, role]) => ({
      alias,
      label: `@${alias}`,
      kind: "role" as const,
      detail: role,
    })),
    ...Object.entries(COMMAND_ALIASES).map(([alias, cmd]) => ({
      alias,
      label: `@${alias}`,
      kind: "command" as const,
      detail: cmd,
    })),
  ];

  const filteredMentions =
    autocompleteFilter.length > 0
      ? allMentions.filter((m) =>
          m.alias.toLowerCase().includes(autocompleteFilter.toLowerCase()),
        )
      : allMentions;

  function handleInputChange(value: string) {
    setInput(value);
    const outcome = parseMention(value);
    if (outcome.success) {
      setResolved({
        label: outcome.commandToken ?? outcome.resolvedRole,
        provider: outcome.requestedProvider,
        role: outcome.resolvedRole,
        mode: outcome.consultationMode,
      });
      setError(null);
    } else {
      setResolved(null);
      setError(outcome.message);
    }

    const atIndex = value.lastIndexOf("@");
    if (atIndex >= 0) {
      const afterAt = value.slice(atIndex + 1);
      if (!afterAt.includes(" ") && afterAt.length <= 20) {
        setShowAutocomplete(true);
        setAutocompleteFilter(afterAt);
        return;
      }
    }
    setShowAutocomplete(false);
    setAutocompleteFilter("");
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && resolved) {
      e.preventDefault();
      const outcome = parseMention(input);
      if (outcome.success) {
        onSubmit(outcome);
        setInput("");
        setResolved(null);
        setError(null);
      }
    }
    if (e.key === "Escape") {
      setShowAutocomplete(false);
    }
  }

  function selectMention(alias: string) {
    const atIndex = input.lastIndexOf("@");
    if (atIndex >= 0) {
      const before = input.slice(0, atIndex);
      const newInput = `${before}@${alias} `;
      setInput(newInput);
      handleInputChange(newInput);
    }
    setShowAutocomplete(false);
  }

  return (
    <div className="relative space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            className="w-full min-h-10 rounded-xl border border-border bg-surface px-3 py-2 text-sm resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={t`@codex check the budget pacing`}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={2}
          />
          {showAutocomplete && filteredMentions.length > 0 ? (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
              {filteredMentions.map((m) => (
                <button
                  key={m.alias}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-primary/10 text-left"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMention(m.alias);
                  }}
                >
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {m.kind}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          size="sm"
          isDisabled={!resolved || (disabled ?? false)}
          onPress={() => {
            if (resolved) {
              const outcome = parseMention(input);
              if (outcome.success) {
                onSubmit(outcome);
                setInput("");
                setResolved(null);
                setError(null);
              }
            }
          }}
        >
          <Trans>Consult</Trans>
        </Button>
      </div>

      {resolved ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
            <Trans>Role:</Trans> {resolved.role}
          </span>
          {resolved.provider ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              <Trans>Provider:</Trans> {resolved.provider}
            </span>
          ) : null}
          <span className="rounded bg-muted px-1.5 py-0.5">
            <Trans>Mode:</Trans> {resolved.mode}
          </span>
        </div>
      ) : null}

      {error && input.length > 0 && !resolved ? (
        <div className="text-xs text-muted-foreground">
          {error.includes("unknown") ? (
            <span>
              <Trans>
                Unknown mention. Try @codex, @claude, @daily-operator, @verify, etc.
              </Trans>
            </span>
          ) : (
            <span>{error}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
