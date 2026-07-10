import { describe, expect, test } from "bun:test";
import { discordTimestamp, formatDateTime } from "../src/formatting";

describe("discordTimestamp", () => {
  test("formats as absolute timestamp by default", () => {
    expect(discordTimestamp(1700000000000)).toBe("<t:1700000000:F>");
  });

  test("supports relative style", () => {
    expect(discordTimestamp(1700000000000, "R")).toBe("<t:1700000000:R>");
  });

  test("supports short absolute style", () => {
    expect(discordTimestamp(1700000000000, "f")).toBe("<t:1700000000:f>");
  });

  test("truncates sub-second precision", () => {
    expect(discordTimestamp(1700000000999)).toBe("<t:1700000000:F>");
  });
});

describe("formatDateTime", () => {
  test("produces a non-empty human readable string", () => {
    const result = formatDateTime(1700000000000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("2023");
  });
});
