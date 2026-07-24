import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Tabs } from "@heroui/react";
import { Send } from "lucide-react";
import type { CampaignContextIdentityViewModel } from "@/renderer/adapters/campaignViewModels";

/**
 * Thread pane header/tabs are wired to the real campaign identity. The
 * conversation body itself (agent messages, `@mention` consultation
 * routing) is Phase 4 scope, owned by a separate workstream — this stays a
 * placeholder on purpose, not because the data isn't available.
 */
export function CampaignThreadPane(props: { identity: CampaignContextIdentityViewModel | null }) {
  const { t } = useLingui();

  const tabs = [
    { id: "monitoring", label: t`Monitoring` },
    { id: "pacing", label: t`Pacing` },
    { id: "plan_revision", label: t`Plan Revision` },
    { id: "client_update", label: t`Client Update` },
    { id: "eoc_report", label: t`EOC Report` },
    { id: "general", label: t`General` },
  ];

  if (!props.identity) {
    return (
      <div className="flex h-full items-center justify-center text-default-400">
        <p>
          <Trans>Select a campaign to view its thread</Trans>
        </p>
      </div>
    );
  }

  const clientDisplay = props.identity.clientName ?? "—";
  const campaignDisplay = props.identity.campaignName;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-divider px-3 py-2">
        <h3 className="text-small font-medium text-foreground">
          {clientDisplay} – {campaignDisplay}
        </h3>
      </header>

      <Tabs
        aria-label={t`Thread topics`}
        variant="secondary"
        className="shrink-0 border-b border-divider px-2"
      >
        <Tabs.ListContainer>
          <Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.id} id={tab.id}>
                {tab.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      {/* Thread messages — Phase 4 scope (multi-agent consultation UI). */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto text-default-400">
        <p className="text-small">
          <Trans>Thread messages will appear here</Trans>
        </p>
        <p className="text-tiny">
          <Trans>(coming in Phase 4)</Trans>
        </p>
      </div>

      {/* Composer placeholder — Phase 4 scope. */}
      <div className="flex shrink-0 items-end gap-2 border-t border-divider p-3">
        <textarea
          aria-label={t`Message composer`}
          placeholder={t`Type a message…`}
          rows={2}
          disabled
          className="flex-1 resize-none rounded-medium border border-divider bg-content1 px-3 py-2 text-small text-foreground placeholder:text-default-400 disabled:opacity-50"
        />
        <Button isIconOnly size="sm" variant="primary" isDisabled aria-label={t`Send message`}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
