import type {
  Project,
  ProjectDraftConfig,
  ProjectLocation,
  ProjectScripts,
  ProjectSearchSettings,
  AppView,
} from "@/shared/contracts";
import { isDraftPaneId, parseDraftProjectId } from "@/shared/paneId";
import { getProjectName } from "@/shared/wsl";
import { reorderIds, type ReorderPlacement } from "../reorder";
import { removePaneFromView } from "./helpers";
import type { SliceCreator } from "./shared";

export interface ProjectSlice {
  projects: Project[];
  addProject: (location: ProjectLocation, nameOverride?: string) => Project;
  deleteProject: (projectId: string) => void;
  updateProjectDraftConfig: (projectId: string, draftConfig: ProjectDraftConfig) => void;
  updateProjectScripts: (projectId: string, scripts: ProjectScripts) => void;
  updateProjectSearchSettings: (
    projectId: string,
    searchSettings: ProjectSearchSettings | undefined,
  ) => void;
  renameProject: (projectId: string, name: string) => void;
  reorderProjects: (sourceId: string, targetId: string, placement: ReorderPlacement) => void;
}

export const createProjectSlice: SliceCreator<ProjectSlice> = (set) => ({
  projects: [],
  addProject: (location, nameOverride) => {
    const project: Project = {
      id: crypto.randomUUID(),
      name: nameOverride?.trim() || getProjectName(location),
      location,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      projects: [project, ...state.projects],
    }));

    return project;
  },
  deleteProject: (projectId) =>
    set((state) => {
      const nextProjects = state.projects.filter((project) => project.id !== projectId);

      if (nextProjects.length === state.projects.length) {
        return {};
      }

      const projectThreadIds = new Set(
        state.threads.filter((thread) => thread.projectId === projectId).map((thread) => thread.id),
      );

      const nextThreads = state.threads.filter((thread) => thread.projectId !== projectId);

      const nextPendingServerRequests = state.pendingServerRequests.filter(
        (request) => !projectThreadIds.has(request.threadId),
      );
      const nextPendingThreadLaunches = Object.fromEntries(
        Object.entries(state.pendingThreadLaunches).filter(
          ([threadId]) => !projectThreadIds.has(threadId),
        ),
      );
      const nextPendingLaunchSegments = Object.fromEntries(
        Object.entries(state.pendingLaunchSegments).filter(
          ([threadId]) => !projectThreadIds.has(threadId),
        ),
      );

      const { [projectId]: _draft, ...nextDraftContents } = state.draftContents;

      let nextView = state.view;
      if (state.view.kind === "draft" && state.view.projectId === projectId) {
        nextView = { kind: "home" };
      } else if (state.view.kind === "thread") {
        nextView = state.view.panes.reduce<AppView>((view, paneId) => {
          if (view.kind !== "thread") return view;
          const shouldRemove = isDraftPaneId(paneId)
            ? parseDraftProjectId(paneId) === projectId
            : projectThreadIds.has(paneId);
          return shouldRemove ? removePaneFromView(view, paneId) : view;
        }, state.view);
      }

      return {
        projects: nextProjects,
        threads: nextThreads,
        pendingServerRequests: nextPendingServerRequests,
        pendingThreadLaunches: nextPendingThreadLaunches,
        pendingLaunchSegments: nextPendingLaunchSegments,
        draftContents: nextDraftContents,
        view: nextView,
      };
    }),
  updateProjectDraftConfig: (projectId, draftConfig) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, lastDraftConfig: draftConfig } : project,
      ),
    })),
  updateProjectScripts: (projectId, scripts) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, scripts } : project,
      ),
    })),
  updateProjectSearchSettings: (projectId, searchSettings) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        if (!searchSettings) {
          const { searchSettings: _, ...rest } = project;
          return rest;
        }
        return { ...project, searchSettings };
      }),
    })),
  renameProject: (projectId, name) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, name } : project,
      ),
    })),
  reorderProjects: (sourceId, targetId, placement) =>
    set((state) => {
      const projectIds = state.projects.map((project) => project.id);
      const reorderedIds = reorderIds(projectIds, sourceId, targetId, placement);

      if (reorderedIds === projectIds) {
        return {};
      }

      const projectsById = new Map(state.projects.map((project) => [project.id, project]));
      const projects = reorderedIds
        .map((id) => projectsById.get(id))
        .filter((project): project is Project => project !== undefined);

      return { projects };
    }),
});
