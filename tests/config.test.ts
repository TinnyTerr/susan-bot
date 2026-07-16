import { describe, expect, test } from "bun:test";
import { bool, int, optional, required, roleList } from "../src/config";

describe("required", () => {
  test("returns the value when set", () => {
    process.env.TEST_REQUIRED = "value";
    expect(required("TEST_REQUIRED")).toBe("value");
    delete process.env.TEST_REQUIRED;
  });

  test("throws when unset", () => {
    delete process.env.TEST_REQUIRED_MISSING;
    expect(() => required("TEST_REQUIRED_MISSING")).toThrow(
      "Missing required environment variable: TEST_REQUIRED_MISSING",
    );
  });
});

describe("optional", () => {
  test("falls back when unset or empty", () => {
    delete process.env.TEST_OPTIONAL;
    expect(optional("TEST_OPTIONAL", "fallback")).toBe("fallback");
    process.env.TEST_OPTIONAL = "";
    expect(optional("TEST_OPTIONAL", "fallback")).toBe("fallback");
  });

  test("returns the set value", () => {
    process.env.TEST_OPTIONAL = "custom";
    expect(optional("TEST_OPTIONAL", "fallback")).toBe("custom");
    delete process.env.TEST_OPTIONAL;
  });
});

describe("roleList", () => {
  test("returns an empty array when unset", () => {
    delete process.env.TEST_ROLE_LIST;
    expect(roleList("TEST_ROLE_LIST")).toEqual([]);
  });

  test("splits, trims, and drops empty entries", () => {
    process.env.TEST_ROLE_LIST = " role-1 ,role-2,, role-3";
    expect(roleList("TEST_ROLE_LIST")).toEqual(["role-1", "role-2", "role-3"]);
    delete process.env.TEST_ROLE_LIST;
  });
});

describe("bool", () => {
  test("falls back when unset", () => {
    delete process.env.TEST_BOOL;
    expect(bool("TEST_BOOL", true)).toBe(true);
    expect(bool("TEST_BOOL", false)).toBe(false);
  });

  test("is case-insensitive true/false", () => {
    process.env.TEST_BOOL = "TRUE";
    expect(bool("TEST_BOOL", false)).toBe(true);
    process.env.TEST_BOOL = "false";
    expect(bool("TEST_BOOL", true)).toBe(false);
    process.env.TEST_BOOL = "nonsense";
    expect(bool("TEST_BOOL", true)).toBe(false);
    delete process.env.TEST_BOOL;
  });
});

describe("int", () => {
  test("falls back when unset or unparsable", () => {
    delete process.env.TEST_INT;
    expect(int("TEST_INT", 42)).toBe(42);
    process.env.TEST_INT = "not-a-number";
    expect(int("TEST_INT", 42)).toBe(42);
    delete process.env.TEST_INT;
  });

  test("parses a set value", () => {
    process.env.TEST_INT = "99";
    expect(int("TEST_INT", 42)).toBe(99);
    delete process.env.TEST_INT;
  });
});
