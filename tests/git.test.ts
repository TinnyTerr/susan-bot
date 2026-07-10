import { describe, expect, test } from "bun:test";
import * as git from "../src/git";

// These run against the real repo checkout (this project itself), since
// git.ts is a thin wrapper around the `git` CLI with no injectable seams.
// That's true both locally and in CI, which always runs from a git checkout.

describe("getCurrentBranch", () => {
  test("returns a non-empty branch name", () => {
    const branch = git.getCurrentBranch();
    expect(branch).not.toBeNull();
    expect(branch!.length).toBeGreaterThan(0);
  });
});

describe("getCurrentCommit", () => {
  test("returns a full-length commit SHA", () => {
    const commit = git.getCurrentCommit();
    expect(commit).not.toBeNull();
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("hasLocalChanges", () => {
  test("returns a boolean without throwing", () => {
    expect(typeof git.hasLocalChanges()).toBe("boolean");
  });
});

describe("getCommitLog", () => {
  test("returns an empty list for an empty range", () => {
    const commit = git.getCurrentCommit()!;
    expect(git.getCommitLog(commit, commit)).toEqual([]);
  });

  test("respects the maxLines cap", () => {
    const commit = git.getCurrentCommit()!;
    const log = git.getCommitLog(`${commit}~1`, commit, 1);
    expect(log.length).toBeLessThanOrEqual(1);
  });
});
