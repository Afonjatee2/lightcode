import { describe, expect, it } from "vitest";
import { parsePrimedEnvDump } from "./processRuntime";

describe("parsePrimedEnvDump", () => {
  it("parses simple NAME=value lines", () => {
    expect(parsePrimedEnvDump(["FOO=bar", "BAZ=qux"])).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("does not append the trailing newline of the env dump to the last variable", () => {
    // `env` output ends with "\n", so splitting produces a trailing "" line.
    // Regression: the last var picked up a trailing "\n" (GH_HOST="github.com\n"
    // broke gh's URL building in every spawned process).
    expect(parsePrimedEnvDump(["GH_CONFIG_DIR=/x", "GH_HOST=github.com", ""])).toEqual({
      GH_CONFIG_DIR: "/x",
      GH_HOST: "github.com",
    });
  });

  it("still joins genuine multiline values, dropping only trailing empties", () => {
    expect(parsePrimedEnvDump(["MULTI=first", "second", "", "third", "SINGLE=x", "", ""])).toEqual({
      MULTI: "first\nsecond\n\nthird",
      SINGLE: "x",
    });
  });

  it("returns an empty record for an all-empty dump", () => {
    expect(parsePrimedEnvDump(["", ""])).toEqual({});
  });
});
