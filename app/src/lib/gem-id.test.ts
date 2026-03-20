import { describe, it, expect } from "vitest";
import { isValidGemId, parseGemIdFromPathname } from "./gem-id";

describe("isValidGemId", () => {
  it("accepts a simple alphanumeric ID", () => {
    expect(isValidGemId("test1")).toBe(true);
  });

  it("accepts an ID with hyphens", () => {
    expect(isValidGemId("test-1")).toBe(true);
  });

  it("accepts an ID at max length (24 chars)", () => {
    expect(isValidGemId("a".repeat(24))).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidGemId("")).toBe(false);
  });

  it("rejects an ID that is too long (25 chars)", () => {
    expect(isValidGemId("a".repeat(25))).toBe(false);
  });

  it("rejects an ID with a space", () => {
    expect(isValidGemId("bad id")).toBe(false);
  });

  it("rejects an ID with special characters", () => {
    expect(isValidGemId("bad!id")).toBe(false);
  });

  it("rejects an ID with an underscore", () => {
    expect(isValidGemId("bad_id")).toBe(false);
  });

  it("accepts uppercase letters", () => {
    expect(isValidGemId("TestID")).toBe(true);
  });

  it("accepts a single character", () => {
    expect(isValidGemId("a")).toBe(true);
  });
});

describe("parseGemIdFromPathname", () => {
  it("returns null for '/'", () => {
    expect(parseGemIdFromPathname("/")).toBeNull();
  });

  it("returns the segment for a valid path", () => {
    expect(parseGemIdFromPathname("/test-1")).toBe("test-1");
  });

  it("returns null for a path with invalid characters", () => {
    expect(parseGemIdFromPathname("/bad id")).toBeNull();
  });

  it("returns null for a path with special characters", () => {
    expect(parseGemIdFromPathname("/bad!!id")).toBeNull();
  });

  it("returns the first segment only (ignores sub-paths)", () => {
    expect(parseGemIdFromPathname("/test-1/extra")).toBe("test-1");
  });

  it("handles multiple leading slashes", () => {
    expect(parseGemIdFromPathname("//test-1")).toBe("test-1");
  });

  it("returns null for a path with a too-long segment", () => {
    expect(parseGemIdFromPathname("/" + "a".repeat(25))).toBeNull();
  });

  it("returns null for empty path string", () => {
    expect(parseGemIdFromPathname("")).toBeNull();
  });

  it("returns the segment for an all-numeric ID", () => {
    expect(parseGemIdFromPathname("/12345")).toBe("12345");
  });
});
