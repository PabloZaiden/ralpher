import { describe, expect, test } from "bun:test";
import {
  applyPublicBasePath,
  getPublicBasePathFromForwardedPrefix,
  getPublicBasePathFromPathname,
  normalizePublicBasePath,
} from "../../src/utils/public-base-path";

describe("public base path utilities", () => {
  test("normalizes public base paths", () => {
    expect(normalizePublicBasePath(undefined)).toBe("");
    expect(normalizePublicBasePath("/")).toBe("");
    expect(normalizePublicBasePath("ralpher/")).toBe("/ralpher");
    expect(normalizePublicBasePath("/ralpher//")).toBe("/ralpher");
  });

  test("derives base paths from forwarded prefixes and pathnames", () => {
    expect(getPublicBasePathFromForwardedPrefix("/proxy/")).toBe("/proxy");
    expect(getPublicBasePathFromPathname("/")).toBe("");
    expect(getPublicBasePathFromPathname("/ralpher/")).toBe("/ralpher");
    expect(getPublicBasePathFromPathname("/ralpher/index.html")).toBe("/ralpher");
  });

  test("applies base paths to local app URLs without touching absolute URLs", () => {
    expect(applyPublicBasePath("/ralpher", "/api/loops")).toBe("/ralpher/api/loops");
    expect(applyPublicBasePath("/ralpher", "loop/test")).toBe("/ralpher/loop/test");
    expect(applyPublicBasePath("/ralpher", "https://example.com/app")).toBe("https://example.com/app");
  });
});
