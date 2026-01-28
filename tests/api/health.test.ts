/**
 * API integration tests for health endpoint.
 */

import { test, expect, describe } from "bun:test";
import { healthRoutes } from "../../src/api/health";
import packageJson from "../../package.json";

describe("GET /api/health", () => {
  test("returns healthy status", async () => {
    const handler = healthRoutes["/api/health"].GET;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.healthy).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version).toBe(packageJson.version);
  });

  test("response has correct content-type", async () => {
    const handler = healthRoutes["/api/health"].GET;
    const response = await handler();

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
