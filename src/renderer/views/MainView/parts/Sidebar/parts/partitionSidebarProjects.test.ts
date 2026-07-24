// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Project } from "@/shared/contracts";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import { partitionSidebarProjects } from "./partitionSidebarProjects";

function project(overrides: Partial<Project> & Pick<Project, "id" | "name">): Project {
  return {
    location: { kind: "posix", path: `/repo/${overrides.id}` },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("partitionSidebarProjects", () => {
  it("keeps code and general projects in the code list", () => {
    const code = project({ id: "code-1", name: "App", purpose: "code" });
    const general = project({ id: "general-1", name: "Notes" });
    const result = partitionSidebarProjects([code, general]);
    expect(result.codeProjectIds).toEqual(["code-1", "general-1"]);
    expect(result.campaignProjectIds).toEqual([]);
  });

  it("routes campaign-purpose projects to the campaigns list only", () => {
    const code = project({ id: "code-1", name: "App" });
    const campaign = project({
      id: "camp-1",
      name: "Client A",
      purpose: "campaign",
      campaignExtension: {
        campaignGroupId: "cg-1",
        clientName: "Client A",
        campaignName: "Spring",
      },
    });
    const result = partitionSidebarProjects([code, campaign]);
    expect(result.codeProjectIds).toEqual(["code-1"]);
    expect(result.campaignProjectIds).toEqual(["camp-1"]);
  });

  it("ignores home-scope projects in both lists", () => {
    const home = project({
      id: HOME_PROJECT_ID,
      name: "Home",
      location: { kind: "posix", path: "/home" },
    });
    const code = project({ id: "code-1", name: "App" });
    const result = partitionSidebarProjects([home, code]);
    expect(result.codeProjectIds).toEqual(["code-1"]);
    expect(result.campaignProjectIds).toEqual([]);
  });
});
