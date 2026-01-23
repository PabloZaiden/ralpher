/**
 * API integration tests for config endpoint.
 */

import { test, expect, describe, afterEach } from "bun:test";
import { settingsRoutes } from "../../src/api/settings";

describe("GET /api/config", () => {
  const originalEnv = process.env["RALPHER_REMOTE_ONLY"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["RALPHER_REMOTE_ONLY"];
    } else {
      process.env["RALPHER_REMOTE_ONLY"] = originalEnv;
    }
  });

  test("returns remoteOnly: false when env var is not set", async () => {
    delete process.env["RALPHER_REMOTE_ONLY"];
    
    const handler = settingsRoutes["/api/config"].GET;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ remoteOnly: false });
  });

  test("returns remoteOnly: true when env var is 'true'", async () => {
    process.env["RALPHER_REMOTE_ONLY"] = "true";
    
    const handler = settingsRoutes["/api/config"].GET;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ remoteOnly: true });
  });

  test("returns remoteOnly: true when env var is '1'", async () => {
    process.env["RALPHER_REMOTE_ONLY"] = "1";
    
    const handler = settingsRoutes["/api/config"].GET;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ remoteOnly: true });
  });

  test("returns remoteOnly: true when env var is 'yes'", async () => {
    process.env["RALPHER_REMOTE_ONLY"] = "yes";
    
    const handler = settingsRoutes["/api/config"].GET;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ remoteOnly: true });
  });

  test("response has correct content-type", async () => {
    const handler = settingsRoutes["/api/config"].GET;
    const response = await handler();

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
