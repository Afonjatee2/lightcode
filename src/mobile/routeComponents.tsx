import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { MessageCircle } from "lucide-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@/renderer/state/appStore";
import type { Thread } from "@/shared/contracts";
import { getBasename } from "@/shared/pathUtils";
import { buildWorktreeLocation } from "@/shared/worktree";
import { useGitSummariesStore } from "./gitSummaries";
import { useMobileApp, useRemote } from "./remoteContext";
import {
  buildFilesTarget,
  buildGitTarget,
  openWorktreeDraft,
  preselectWorktreeDraft,
  runThreadAction,
} from "./navHelpers";
import {
  clearPairingLaunch,
  isMixedContentEndpoint,
  normalizePairingEndpoint,
  parsePairingLaunch,
  parsePairingUrl,
  subscribePairingLaunch,
} from "./pairing";
import { MobileSetupEmptyState, type MobileSetupKind } from "./setupEmptyState";
import { EmptyState } from "./components";
import { isDesktopSettingsSection } from "./settingsSections";
import type { MobileSshPairRequest } from "./views/DesktopsView";
import { useGitSummaryHydration } from "./useGitSummaryHydration";
import { DESKTOP_RIGHT_PANEL_QUERY, useMediaQuery, WIDE_SHELL_QUERY } from "./useMediaQuery";
import { useDesktopPanelStore } from "./desktopPanelStore";
import { DesktopsView } from "./views/DesktopsView";
import { ManageProjectsView } from "./views/ManageProjectsView";
import { MoreView } from "./views/MoreView";
import { ThreadsView } from "./views/ThreadsView";

const NewThreadFlow = lazy(() =>
  import("./views/NewThreadFlow").then((module) => ({ default: module.NewThreadFlow })),
);
const QuickCompose = lazy(() =>
  import("./views/QuickCompose").then((module) => ({ default: module.QuickCompose })),
);
const ThreadView = lazy(() =>
  import("./views/ThreadView").then((module) => ({ default: module.ThreadView })),
);

const BrowserView = lazy(() =>
  import("./views/BrowserView").then((module) => ({ default: module.BrowserView })),
);
const PortsView = lazy(() =>
  import("./views/PortsView").then((module) => ({ default: module.PortsView })),
);
const WorkspaceView = lazy(() =>
  import("./views/WorkspaceView").then((module) => ({ default: module.WorkspaceView })),
);
const TerminalView = lazy(() =>
  import("./views/TerminalView").then((module) => ({ default: module.TerminalView })),
);
const NotesView = lazy(() =>
  import("./views/NotesView").then((module) => ({ default: module.NotesView })),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((module) => ({ default: module.SettingsView })),
);
const UsagePanel = lazy(() =>
  import("@/renderer/views/MainView/parts/RightPanel/parts/UsagePanel/UsagePanel").then(
    (module) => ({
      default: module.UsagePanel,
    }),
  ),
);

// Typed route APIs (params/search) — decoupled from the route consts so this
// file never imports router.tsx (which imports these components).
const threadRouteApi = getRouteApi("/thread/$threadId");
const notesRouteApi = getRouteApi("/notes/$threadId");
const settingsSectionRouteApi = getRouteApi("/settings/$section");
const workspaceRouteApi = getRouteApi("/workspace/$threadId");
const terminalRouteApi = getRouteApi("/terminal/$projectId");

function LazyRoute(props: { readonly children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="m-page m-route-loading">
          <div className="text-sm text-muted">
            <Trans>Loading…</Trans>
          </div>
        </div>
      }
    >
      {props.children}
    </Suspense>
  );
}

/**
 * Suspense boundary for the fullscreen overlay routes (workspace, terminal).
 * Their push/pop navigations slide via the `m-screen` view-transition group,
 * and the view transition captures whatever the route renders at commit time —
 * on a cold chunk that's the fallback, so the fallback itself must be a
 * fullscreen, `m-screen`-named surface or the slide has nothing to animate
 * (the old page then just dissolves via the root cross-fade, and the late-
 * arriving screen paints with no coherent entry). Connected sessions warm
 * these chunks after the first paint, keeping the fallback a rare sight.
 */
function FullscreenLazyRoute(props: { readonly children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <section className="m-screen-loading">
          <div className="text-sm text-muted">
            <Trans>Loading…</Trans>
          </div>
        </section>
      }
    >
      {props.children}
    </Suspense>
  );
}

/**
 * Shared thread detail pane. Used by the /thread/:id route and, in the wide
 * layout, by the /threads route (where the list lives in the sidebar and the
 * detail shows the selected thread, or an empty state when none is selected).
 */
function ThreadDetail(props: { readonly thread: Thread | null; readonly hideHeader: boolean }) {
  const remote = useRemote();
  const navigate = useNavigate();
  const useRightPanel = useMediaQuery(DESKTOP_RIGHT_PANEL_QUERY);
  const thread = props.thread;
  const threadId = thread?.id ?? null;
  // Ensure the displayed thread is actually OPEN, not just rendered: the wide
  // shell auto-selects the most recent thread and deep links land here
  // directly — neither goes through a list click. Opening marks the thread
  // watched in the shared store (clearing a stale finished/done badge so live
  // idle events don't keep re-earning it) and loads its history snapshot.
  // openThread is idempotent and guards against duplicate in-flight loads, so
  // the click path (store already watching, snapshot still fetching) is cheap.
  //
  // Also keyed on the active desktop id: on a cold deep-link load the thread is
  // seeded from the localStorage mirror (so threadId is stable from the first
  // render) while the desktop connection is still being established async.
  // openThread bails when activeDesktop is null, so without this dep the effect
  // never retries once the desktop connects and the history snapshot never
  // loads — a blank transcript. The watched+hasSnapshot guard keeps the retry
  // from redundantly reopening an already-loaded thread.
  const activeDesktopId = remote.activeDesktop?.desktopId ?? null;
  useEffect(() => {
    if (!threadId) return;
    const state = useAppStore.getState();
    const watched = state.view.kind === "thread" && state.view.panes.includes(threadId);
    const hasSnapshot = remote.selectedThreadSnapshot?.thread.id === threadId;
    if (watched && hasSnapshot) return;
    const target = remote.threads.find((entry) => entry.id === threadId);
    if (target) void remote.openThread(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the displayed thread id + active desktop; openThread guards the racing click path
  }, [threadId, activeDesktopId]);
  if (!thread) {
    return (
      <section className="m-thread">
        <EmptyState
          icon={<MessageCircle className="size-5" />}
          title={<Trans>No thread selected</Trans>}
          hint={<Trans>Pick a thread from the list to follow the agent from here.</Trans>}
        />
      </section>
    );
  }
  // Still fetching this thread's history when no snapshot matches it yet.
  const loading = remote.selectedThreadSnapshot?.thread.id !== thread.id;
  return (
    <LazyRoute>
      <ThreadView
        thread={thread}
        terminalScrollback={remote.selectedThreadSnapshot?.terminalScrollback}
        terminalSize={remote.selectedThreadSnapshot?.terminalSize}
        hideHeader={props.hideHeader}
        loading={loading}
        onThreadAction={(action) =>
          runThreadAction(remote, thread, action, () => void navigate({ to: "/threads" }))
        }
        onSubmitInput={(prompt, segments) => remote.sendPrompt(prompt, segments)}
        onOpenWorkspace={(tab) => {
          if (useRightPanel) {
            useDesktopPanelStore.getState().show(tab === "changes" ? "git" : "files", thread.id);
            return;
          }
          void navigate({
            to: "/workspace/$threadId",
            params: { threadId: thread.id },
            search: { tab },
          });
        }}
        onOpenWorkspaceFile={(path, lineNumber) => {
          if (useRightPanel) {
            useDesktopPanelStore.getState().showFile(thread.id, path, lineNumber);
            return;
          }
          void navigate({
            to: "/workspace/$threadId",
            params: { threadId: thread.id },
            search: {
              tab: "files",
              file: path,
              ...(lineNumber !== undefined ? { line: lineNumber } : {}),
            },
          });
        }}
        onOpenWorkspaceFolder={(path) => {
          if (useRightPanel) {
            useDesktopPanelStore.getState().showFolder(thread.id, path);
            return;
          }
          void navigate({
            to: "/workspace/$threadId",
            params: { threadId: thread.id },
            search: { tab: "files", folder: path },
          });
        }}
        onOpenTerminal={() => {
          if (useRightPanel) {
            useDesktopPanelStore.getState().show("terminal", thread.id);
            return;
          }
          void navigate({
            to: "/terminal/$projectId",
            params: { projectId: thread.projectId },
            search: {
              fromThread: thread.id,
              ...(thread.worktreePath ? { worktree: thread.worktreePath } : {}),
            },
          });
        }}
        onOpenNotes={() => {
          if (useRightPanel) {
            useDesktopPanelStore.getState().show("notes", thread.id);
            return;
          }
          void navigate({
            to: "/notes/$threadId",
            params: { threadId: thread.id },
          });
        }}
        onNewThreadInWorktree={(input) => {
          if (props.hideHeader) {
            preselectWorktreeDraft(input);
            void navigate({ to: "/threads" });
            return;
          }
          void openWorktreeDraft(input, () => navigate({ to: "/new" }));
        }}
        onDeleteWorktreeGroup={(input) => {
          void remote.deleteWorktreeGroup(input);
          void navigate({ to: "/threads" });
        }}
      />
    </LazyRoute>
  );
}

export function ThreadsRoute() {
  const {
    remote,
    projectFilter,
    setProjectFilter,
    threadSearchOpen,
    setThreadSearchOpen,
    threadSearchHost,
  } = useMobileApp();
  const navigate = useNavigate();
  const isWide = useMediaQuery(WIDE_SHELL_QUERY);
  // The home composer's expand state (kept here so the list's empty-state
  // "New thread" button grows the same bubble as a tap on it).
  const hasPendingWorktreeDraft = useAppStore(
    (state) => Object.keys(state.pendingDraftWorktreeSelections).length > 0,
  );
  const [composeExpanded, setComposeExpanded] = useState(hasPendingWorktreeDraft);
  const [restoreWorktreeSelectionToken, setRestoreWorktreeSelectionToken] = useState(0);
  const readyToCompose = remote.connection === "online" && remote.projects.length > 0;
  const needsDesktop = remote.connection !== "online";
  const setupKind: MobileSetupKind | null = readyToCompose
    ? null
    : needsDesktop
      ? "desktop"
      : "project";
  const setupEmptyState =
    setupKind === null ? null : (
      <MobileSetupEmptyState
        kind={setupKind}
        onAction={(kind) =>
          void navigate(kind === "desktop" ? { to: "/desktops" } : { to: "/projects" })
        }
      />
    );

  // The narrow list is the "away from every thread" surface: reset the shared
  // view so threads finishing from here on count as unwatched (the store
  // downgrades their idle transition to the "Finished" badge). openThread in
  // useRemoteDesktop sets the view back when a thread is opened. Wide shells
  // keep the detail pane mounted, so the view stays on the selected thread.
  useEffect(() => {
    if (!isWide) useAppStore.getState().openHome();
  }, [isWide]);

  // Worktree actions from another narrow route return here with a one-shot
  // target already queued. Reveal the inline composer that will consume it.
  useEffect(() => {
    if (hasPendingWorktreeDraft) setComposeExpanded(true);
  }, [hasPendingWorktreeDraft]);

  // Once a desktop is connected, warm the fullscreen chunks after first paint
  // so their push transition normally captures real content. Disconnected
  // startup keeps them off the network entirely.
  const activeDesktopId = remote.activeDesktop?.desktopId;
  useEffect(() => {
    if (!activeDesktopId) return;
    const warmFullscreenChunks = () => {
      void import("./views/WorkspaceView");
      void import("./views/TerminalView");
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warmFullscreenChunks, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(warmFullscreenChunks, 2_000);
    return () => window.clearTimeout(handle);
  }, [activeDesktopId]);

  // Wide: the sidebar already owns the list. Keep the detail empty until the
  // user explicitly opens a thread or navigates to /new.
  if (isWide) {
    return <ThreadDetail thread={null} hideHeader={false} />;
  }

  return (
    <>
      <ThreadsView
        projects={remote.projects}
        threads={remote.threads}
        selectedThreadId={null}
        projectFilter={projectFilter}
        loading={!remote.booted}
        searchOpen={threadSearchOpen}
        searchContainer={threadSearchHost}
        onSearchOpenChange={setThreadSearchOpen}
        onProjectFilterChange={setProjectFilter}
        onOpenThread={(thread) => {
          void remote.openThread(thread);
          void navigate({ to: "/thread/$threadId", params: { threadId: thread.id } });
        }}
        onThreadAction={(thread, action) => {
          void remote.applyThreadAction(thread, action);
        }}
        onDeleteWorktreeGroup={(input) => {
          void remote.deleteWorktreeGroup(input);
        }}
        onNew={() => setComposeExpanded(true)}
        onNewThreadInWorktree={(input) => {
          preselectWorktreeDraft(input);
          setComposeExpanded(true);
        }}
        onOpenTerminal={(input) =>
          void navigate({
            to: "/terminal/$projectId",
            params: { projectId: input.projectId },
            search: {
              ...(input.sourceThreadId ? { fromThread: input.sourceThreadId } : {}),
              ...(input.worktreePath ? { worktree: input.worktreePath } : {}),
            },
          })
        }
        onRunProjectAction={(input) =>
          void navigate({
            to: "/terminal/$projectId",
            params: { projectId: input.projectId },
            search: {
              action: input.actionId,
              ...(input.sourceThreadId ? { fromThread: input.sourceThreadId } : {}),
              ...(input.worktreePath ? { worktree: input.worktreePath } : {}),
            },
          })
        }
        {...(setupEmptyState ? { emptyStateOverride: setupEmptyState } : {})}
      />
      {readyToCompose ? (
        <Suspense fallback={null}>
          <QuickCompose
            expanded={composeExpanded}
            restoreWorktreeSelectionToken={restoreWorktreeSelectionToken}
            onExpandedChange={(expanded) => {
              if (!expanded) setRestoreWorktreeSelectionToken((token) => token + 1);
              setComposeExpanded(expanded);
            }}
            onStarted={(threadId) => {
              setComposeExpanded(false);
              void navigate({ to: "/thread/$threadId", params: { threadId } });
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export function ThreadRoute() {
  const { threadId } = threadRouteApi.useParams();
  const remote = useRemote();
  const isWide = useMediaQuery(WIDE_SHELL_QUERY);
  // Opening (store watch + snapshot load) is owned by ThreadDetail's effect: it
  // also covers the fallback-selected thread on reloads, which a check against
  // remote.selectedThread here would wrongly consider already open.
  const thread = remote.threads.find((entry) => entry.id === threadId) ?? null;
  return <ThreadDetail thread={thread} hideHeader={!isWide} />;
}

/**
 * The /new route: the New-thread composer pane on every layout.
 */
export function NewThreadRoute() {
  const navigate = useNavigate();
  return (
    <LazyRoute>
      <NewThreadFlow
        onStarted={(threadId) => void navigate({ to: "/thread/$threadId", params: { threadId } })}
        onSetupAction={(kind) =>
          void navigate(kind === "desktop" ? { to: "/desktops" } : { to: "/projects" })
        }
      />
    </LazyRoute>
  );
}

export function DesktopsRoute() {
  const remote = useRemote();
  const navigate = useNavigate();
  const { t } = useLingui();
  // A launch/deep-link pairing offer prefills the form for the user to CONFIRM
  // (see useDeepLinkPairing). Reactive so a warm deep link re-prefills.
  const launch = useSyncExternalStore(
    subscribePairingLaunch,
    parsePairingLaunch,
    parsePairingLaunch,
  );
  const [manualEndpoint, setManualEndpoint] = useState(launch.endpoint);
  const [manualToken, setManualToken] = useState(launch.credential ?? "");
  const lastLaunchRef = useRef(launch);
  useEffect(() => {
    if (launch !== lastLaunchRef.current) {
      lastLaunchRef.current = launch;
      if (launch.credential) {
        setManualEndpoint(launch.endpoint);
        setManualToken(launch.credential);
      }
    }
  }, [launch]);
  const manualEndpointValue = manualEndpoint.trim();
  const manualTokenValue = manualToken.trim();
  const manualPairingLink =
    parsePairingUrl(manualTokenValue) ?? parsePairingUrl(manualEndpointValue);
  const canPairManually = Boolean(
    manualPairingLink?.credential || (manualEndpointValue && manualTokenValue),
  );

  async function pair(endpoint: string, credential: string) {
    let normalizedEndpoint: string;
    try {
      normalizedEndpoint = normalizePairingEndpoint(endpoint);
    } catch {
      toast.danger(t`Enter a valid desktop endpoint.`);
      return;
    }
    try {
      await remote.pairDesktop(normalizedEndpoint, credential);
      clearPairingLaunch();
      setManualToken("");
      void navigate({ to: "/threads" });
    } catch (error) {
      // Chromium can prompt for local-network access and permit this request.
      // Attempt it before showing fallback guidance so that prompt can appear.
      if (isMixedContentEndpoint(normalizedEndpoint)) {
        toast.danger(
          t`Couldn't reach the desktop. If the browser asked to access your local network, allow it and pair again. Otherwise open the pairing link directly from the desktop (LAN), or expose the desktop over HTTPS.`,
        );
        return;
      }
      toast.danger(error instanceof Error ? error.message : t`Unable to pair with that desktop.`);
    }
  }

  function submitManualPairing() {
    const endpoint = manualEndpointValue;
    const token = manualTokenValue;
    const parsed = manualPairingLink;
    if (parsed?.credential) {
      void pair(parsed.endpoint, parsed.credential);
      return;
    }
    if (!endpoint || !token) return;
    void pair(endpoint, token);
  }

  function handleScan(value: string) {
    const parsed = parsePairingUrl(value);
    if (!parsed?.credential) {
      toast.danger(t`That QR code isn't a Poracode pairing link.`);
      return;
    }
    void pair(parsed.endpoint, parsed.credential);
  }

  async function pairSsh(input: MobileSshPairRequest) {
    await remote.pairSsh(
      {
        id: crypto.randomUUID(),
        label: input.target,
        target: input.target,
        port: input.port,
        authentication: input.authentication.kind,
        hostKeyFingerprint: input.fingerprint,
      },
      input.authentication,
    );
    void navigate({ to: "/threads" });
  }

  return (
    <DesktopsView
      desktops={remote.desktops}
      activeDesktopId={remote.activeDesktopId}
      manualEndpoint={manualEndpoint}
      manualToken={manualToken}
      canPair={canPairManually}
      showPairingHint={launch.credential !== null}
      pairing={remote.connection === "pairing"}
      onEndpointChange={setManualEndpoint}
      onTokenChange={setManualToken}
      onPair={submitManualPairing}
      onScan={handleScan}
      onSwitch={(desktop) => {
        void remote.switchDesktop(desktop).then(() => navigate({ to: "/threads" }));
      }}
      onRename={(desktop, label) => {
        void remote.rename(desktop, label);
      }}
      onForget={(desktop) => {
        void remote.forget(desktop);
      }}
      onProbeSsh={remote.probeSshHost}
      onPairSsh={pairSsh}
    />
  );
}

export function MoreRoute() {
  const remote = useRemote();
  const navigate = useNavigate();
  return (
    <MoreView
      hasDesktop={remote.activeDesktop !== null}
      onOpen={() => void navigate({ to: "/settings/desktop" })}
      onOpenSettingsSection={(section) =>
        void navigate({ to: "/settings/$section", params: { section } })
      }
    />
  );
}

export function ProjectsRoute() {
  const remote = useRemote();
  const canManage = remote.activeDesktop?.scopes.includes("projects:manage") ?? false;
  return (
    <div className="m-subscreen">
      <ManageProjectsView
        projects={remote.projects}
        canManage={canManage}
        onCommand={(command) => remote.manageProject(command)}
      />
    </div>
  );
}

export function UsageRoute() {
  const navigate = useNavigate();
  return (
    <LazyRoute>
      <div className="m-subscreen">
        <UsagePanel
          onOpenUsageSettings={() =>
            void navigate({ to: "/settings/$section", params: { section: "usage" } })
          }
        />
      </div>
    </LazyRoute>
  );
}

export function BrowserRoute() {
  return (
    <LazyRoute>
      <BrowserView />
    </LazyRoute>
  );
}

export function PortsRoute() {
  return (
    <LazyRoute>
      <PortsView />
    </LazyRoute>
  );
}

function SettingsRoute(props: { readonly sectionId: string | null }) {
  const remote = useRemote();
  const navigate = useNavigate();
  const requiresDesktop = props.sectionId === null || isDesktopSettingsSection(props.sectionId);

  useEffect(() => {
    if (requiresDesktop && remote.booted && !remote.activeDesktop) {
      void navigate({ to: "/settings", replace: true });
    }
  }, [navigate, remote.activeDesktop, remote.booted, requiresDesktop]);

  if (requiresDesktop && !remote.activeDesktop) return null;

  return (
    <LazyRoute>
      <SettingsView
        threads={remote.threads}
        projects={remote.projects}
        sectionId={props.sectionId}
        onSectionChange={(section) => {
          void navigate(
            section
              ? { to: "/settings/$section", params: { section } }
              : { to: "/settings/desktop" },
          );
        }}
        onThreadAction={(thread, action) => {
          void remote.applyThreadAction(thread, action);
        }}
      />
    </LazyRoute>
  );
}

export function SettingsListRoute() {
  return <SettingsRoute sectionId={null} />;
}

export function SettingsSectionRoute() {
  const { section } = settingsSectionRouteApi.useParams();
  return <SettingsRoute sectionId={section} />;
}

export function WorkspaceRoute() {
  const { threadId } = workspaceRouteApi.useParams();
  const { tab, file, folder, line } = workspaceRouteApi.useSearch();
  const remote = useRemote();
  const navigate = useNavigate();
  const isWide = useMediaQuery(WIDE_SHELL_QUERY);
  const useRightPanel = useMediaQuery(DESKTOP_RIGHT_PANEL_QUERY);
  const { t } = useLingui();
  const thread = remote.threads.find((entry) => entry.id === threadId) ?? null;
  const project = thread
    ? (remote.projects.find((entry) => entry.id === thread.projectId) ?? null)
    : null;
  useGitSummaryHydration(thread, project);

  // A non-repo thread still has a Files tab; the Changes tab only appears when
  // the thread's working tree is a git repo (per the cached summary).
  const isRepo = useGitSummariesStore((s) => s.byThread[threadId]?.isRepo === true);
  const filesTarget = buildFilesTarget(remote, threadId);
  const gitTarget = isRepo ? buildGitTarget(remote, threadId) : null;
  const hasTarget = Boolean(filesTarget);

  // If the thread/project never resolves (e.g. a stale deep link), bail out to
  // the thread list once the session has booted.
  useEffect(() => {
    if (remote.booted && !hasTarget) void navigate({ to: "/threads" });
  }, [remote.booted, hasTarget, navigate]);

  useEffect(() => {
    if (!useRightPanel || !hasTarget) return;
    const panel = useDesktopPanelStore.getState();
    if (file) panel.showFile(threadId, file, line);
    else if (folder) panel.showFolder(threadId, folder);
    else panel.show(tab === "changes" ? "git" : "files", threadId);
    void navigate({
      to: "/thread/$threadId",
      params: { threadId },
      replace: true,
    });
  }, [file, folder, hasTarget, line, navigate, tab, threadId, useRightPanel]);

  if (!filesTarget) return null;
  if (useRightPanel) {
    return null;
  }
  // The workspace belongs to a thread; closing returns there deterministically
  // (robust even on a fresh load with no back-history).
  return (
    <FullscreenLazyRoute>
      <WorkspaceView
        key={threadId}
        gitTarget={gitTarget}
        filesTarget={filesTarget}
        initialTab={isRepo ? tab : "files"}
        {...(file ? { initialFilePath: file } : {})}
        {...(folder ? { initialFolderPath: folder } : {})}
        {...(line ? { initialLineNumber: line } : {})}
        onClose={() => void navigate({ to: "/thread/$threadId", params: { threadId } })}
        onOpenWorktreeBranch={({ worktreePath, worktreeBranch }) => {
          const worktreeThread = remote.threads.find(
            (entry) =>
              entry.projectId === filesTarget.project.id && entry.worktreePath === worktreePath,
          );
          if (worktreeThread) {
            void navigate({
              to: "/workspace/$threadId",
              params: { threadId: worktreeThread.id },
              search: { tab: "changes" },
            });
            return;
          }
          const input = {
            projectId: filesTarget.project.id,
            worktreePath,
            worktreeBranch,
          };
          if (!isWide) {
            preselectWorktreeDraft(input);
            void navigate({ to: "/threads" });
            return;
          }
          void openWorktreeDraft(input, () => navigate({ to: "/new" }));
        }}
        onLaunchConflictResolverThread={(input) => {
          remote
            .startThread(filesTarget.project, input)
            .then((resolverThreadId) => {
              if (resolverThreadId) {
                void navigate({
                  to: "/thread/$threadId",
                  params: { threadId: resolverThreadId },
                });
              }
            })
            .catch((error: unknown) => {
              toast.danger(error instanceof Error ? error.message : t`Unable to start the thread.`);
            });
        }}
      />
    </FullscreenLazyRoute>
  );
}

export function NotesRoute() {
  const { threadId } = notesRouteApi.useParams();
  const remote = useRemote();
  const navigate = useNavigate();
  const useRightPanel = useMediaQuery(DESKTOP_RIGHT_PANEL_QUERY);
  const thread = remote.threads.find((entry) => entry.id === threadId) ?? null;
  const project = thread
    ? (remote.projects.find((entry) => entry.id === thread.projectId) ?? null)
    : null;

  useEffect(() => {
    if (remote.booted && !project) {
      void navigate({ to: "/threads", replace: true });
    }
  }, [navigate, project, remote.booted]);

  useEffect(() => {
    if (!useRightPanel || !project) return;
    useDesktopPanelStore.getState().show("notes", threadId);
    void navigate({
      to: "/thread/$threadId",
      params: { threadId },
      replace: true,
    });
  }, [navigate, project, threadId, useRightPanel]);

  if (!project || useRightPanel) return null;

  return (
    <FullscreenLazyRoute>
      <NotesView
        key={project.id}
        projectId={project.id}
        projectName={project.name}
        onClose={() =>
          void navigate({
            to: "/thread/$threadId",
            params: { threadId },
          })
        }
      />
    </FullscreenLazyRoute>
  );
}

export function TerminalRoute() {
  const { projectId } = terminalRouteApi.useParams();
  const { worktree, action, fromThread } = terminalRouteApi.useSearch();
  const remote = useRemote();
  const navigate = useNavigate();
  const project = remote.projects.find((entry) => entry.id === projectId);
  const sourceThread = fromThread
    ? remote.threads.find((entry) => entry.id === fromThread)
    : undefined;
  const hasProject = Boolean(project);

  useEffect(() => {
    if (remote.booted && !hasProject) void navigate({ to: "/threads" });
  }, [remote.booted, hasProject, navigate]);

  if (!project) return null;
  const projectLocation = worktree
    ? buildWorktreeLocation(project.location, worktree)
    : project.location;
  const projectAction = action
    ? project.scripts?.actions?.find((entry) => entry.id === action)
    : undefined;
  const title = projectAction?.name ?? (worktree ? getBasename(worktree) : project.name);
  function closeTerminal(): void {
    if (sourceThread) {
      void navigate({ to: "/thread/$threadId", params: { threadId: sourceThread.id } });
      return;
    }
    void navigate({ to: "/threads" });
  }
  return (
    <FullscreenLazyRoute>
      {/*
        TanStack Router keeps this component mounted across param/search changes,
        but TerminalView seeds its tabs once and starts each shell keyed on its
        shellId — so without a target-scoped key, navigating to a different
        project/worktree/action would reuse the old PTY in the old cwd and skip
        the new action's initial command. Remount on any target change instead.
      */}
      <TerminalView
        key={`${projectId}:${worktree ?? ""}:${action ?? ""}`}
        title={title}
        projectLocation={projectLocation}
        {...(worktree ? { worktreePath: worktree } : {})}
        {...(projectAction?.command ? { initialCommand: projectAction.command } : {})}
        onClose={closeTerminal}
      />
    </FullscreenLazyRoute>
  );
}
