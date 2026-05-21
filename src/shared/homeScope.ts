import type { Project } from "./contracts";

export const HOME_PROJECT_ID = "__lightcode_home__";
export const HOME_PROJECT_NAME = "Home";

export function isHomeProjectId(projectId: string | undefined): boolean {
  return projectId === HOME_PROJECT_ID;
}

export function isHomeProject(project: Pick<Project, "id"> | undefined): boolean {
  return isHomeProjectId(project?.id);
}
