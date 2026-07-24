import { useEffect } from "react";
import { Trans } from "@lingui/react/macro";
import { Sparkles } from "lucide-react";
import type { ConsultationRecord, PanelMembershipRecord } from "@/shared/consultations";
import {
  cancelConsultation,
  loadConsultationsForThread,
  retryConsultation,
  subscribeToConsultationUpdates,
} from "@/renderer/actions/consultationActions";
import { ControlCentreDataBlock } from "@/renderer/campaign/cockpit/ControlCentreDataBlock";
import { useConsultationStore } from "./consultationStore";
import { ConsultationCard } from "./ConsultationCard";
import { ConsultationPanelCard } from "./ConsultationPanelCard";

interface ConsultationDockProps {
  threadId: string;
  onOpenThread?: (threadId: string) => void;
}

/**
 * Mounted consultation surface (Part 6). Lives in the campaign-thread workspace:
 * loads the thread's durable consultations on open, subscribes to live lifecycle
 * updates (unsubscribing on unmount), and renders standard / panel / finalise
 * cards with cancel + retry + child-thread navigation wired to the IPC actions.
 */
export function ConsultationDock({ threadId, onOpenThread }: ConsultationDockProps) {
  const records = useConsultationStore((s) => s.records);
  const panelMembers = useConsultationStore((s) => s.panelMembers);

  useEffect(() => {
    void loadConsultationsForThread(threadId);
    return subscribeToConsultationUpdates();
  }, [threadId]);

  const childIds = new Set<string>();
  for (const members of panelMembers.values()) {
    for (const member of members) childIds.add(member.childConsultationId);
  }
  const topLevel = [...records.values()]
    .filter((record) => record.parentThreadId === threadId && !childIds.has(record.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (topLevel.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--hairline)] py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Sparkles size={12} />
        <Trans>Consultations</Trans>
      </div>
      {/* No nested scroll: the campaign thread pane is already scrollable, so a
          bounded `max-h` + `overflow-y-auto` here created a scroll-within-scroll
          that clipped a second consultation's CONTROL CENTRE block at the inner
          edge. Let the cards flow in the thread's own scroll region instead. */}
      <div className="flex flex-col gap-3">
        {topLevel.map((record) =>
          record.consultationMode === "panel" ? (
            <PanelCardContainer
              key={record.id}
              record={record}
              members={panelMembers.get(record.id) ?? []}
              threadId={threadId}
              {...(onOpenThread ? { onOpenThread } : {})}
            />
          ) : (
            <StandardCardContainer
              key={record.id}
              record={record}
              threadId={threadId}
              {...(onOpenThread ? { onOpenThread } : {})}
            />
          ),
        )}
      </div>
    </div>
  );
}

function StandardCardContainer({
  record,
  threadId: _threadId,
  onOpenThread,
}: {
  record: ConsultationRecord;
  threadId: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const contextPackets = useConsultationStore((s) => s.contextPackets);
  const getAttachment = useConsultationStore((s) => s.getAttachment);
  const resultAttachment = record.status === "completed" ? getAttachment(record.id) : null;

  const contextPacket = record.contextPacketId
    ? (contextPackets.get(record.contextPacketId) ?? null)
    : null;
  const evidenceFreshness = contextPacket?.evidenceFreshness ?? null;
  const missingDataWarnings = contextPacket?.missingDataWarnings ?? [];
  const hasBudget = contextPacket
    ? contextPacket.structuredContext.budget.totalBudget !== null
    : true;
  const hasPlan = contextPacket ? contextPacket.structuredContext.kpiEvidence.length > 0 : true;
  const controlCentreAvailable = contextPacket !== null;
  const canCancel =
    record.status !== "completed" &&
    record.status !== "failed" &&
    record.status !== "cancelled" &&
    record.status !== "cancel_requested";
  const canRetry = record.status === "failed" || record.status === "cancelled";
  return (
    <>
      {contextPacket ? (
        <ControlCentreDataBlock
          context={contextPacket.structuredContext}
          capturedAt={
            contextPacket.createdAt
              ? new Date(contextPacket.createdAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null
          }
        />
      ) : null}
      <ConsultationCard
        record={record}
        resultAttachment={resultAttachment}
        evidenceFreshness={evidenceFreshness}
        missingDataWarnings={missingDataWarnings}
        onCancel={(id) => void cancelConsultation(id)}
        onRetry={(id) => void retryConsultation(id)}
        onNavigateToChild={(childId) => onOpenThread?.(childId)}
        canCancel={canCancel}
        canRetry={canRetry}
        hasBudget={hasBudget}
        hasPlan={hasPlan}
        controlCentreAvailable={controlCentreAvailable}
      />
    </>
  );
}

function PanelCardContainer({
  record,
  members,
  threadId: _threadId,
  onOpenThread,
}: {
  record: ConsultationRecord;
  members: PanelMembershipRecord[];
  threadId: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const contextPackets = useConsultationStore((s) => s.contextPackets);
  const getAttachment = useConsultationStore((s) => s.getAttachment);
  const recordsById = useConsultationStore((s) => s.records);
  const panelResult = record.status === "completed" ? getAttachment(record.id) : null;

  const contextPacket = record.contextPacketId
    ? (contextPackets.get(record.contextPacketId) ?? null)
    : null;
  const evidenceFreshness = contextPacket?.evidenceFreshness ?? null;
  const missingDataWarnings = contextPacket?.missingDataWarnings ?? [];
  const hasBudget = contextPacket
    ? contextPacket.structuredContext.budget.totalBudget !== null
    : true;
  const hasPlan = contextPacket ? contextPacket.structuredContext.kpiEvidence.length > 0 : true;
  const controlCentreAvailable = contextPacket !== null;
  const memberStates = members
    .map((membership) => {
      const memberRecord = recordsById.get(membership.childConsultationId);
      if (!memberRecord) return null;
      return {
        record: memberRecord,
        result: memberRecord.status === "completed" ? getAttachment(memberRecord.id) : null,
        memberRole: membership.memberRole,
        requiredOrOptional: membership.requiredOrOptional,
      };
    })
    .filter((member): member is NonNullable<typeof member> => member !== null);

  const canCancel =
    record.status !== "completed" &&
    record.status !== "failed" &&
    record.status !== "cancelled" &&
    record.status !== "cancel_requested";

  return (
    <ConsultationPanelCard
      panelRecord={record}
      panelResult={panelResult}
      members={memberStates}
      evidenceFreshness={evidenceFreshness}
      missingDataWarnings={missingDataWarnings}
      hasBudget={hasBudget}
      hasPlan={hasPlan}
      controlCentreAvailable={controlCentreAvailable}
      {...(canCancel ? { onCancel: (id: string) => void cancelConsultation(id) } : {})}
      {...(record.status === "failed" || record.status === "cancelled"
        ? { onRetry: (id: string) => void retryConsultation(id) }
        : {})}
      {...(onOpenThread ? { onNavigateToChild: (childId: string) => onOpenThread(childId) } : {})}
    />
  );
}
