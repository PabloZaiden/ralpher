/**
 * API integration tests for server kill endpoint.
 * 
 * Note: We cannot actually test that process.exit() is called since that
 * would terminate the test runner. We can only verify the response.
 */

import { test, expect, describe, mock, afterEach } from "bun:test";
import { settingsRoutes } from "../../src/api/settings";

describe("POST /api/server/kill", () => {
  // Store the original process.exit
  const originalExit = process.exit;

  afterEach(() => {
    // Restore process.exit after each test
    process.exit = originalExit;
  });

  test("returns success response with shutdown message", async () => {
    // Mock process.exit to prevent actual termination
    process.exit = mock(() => {}) as unknown as typeof process.exit;

    const handler = settingsRoutes["/api/server/kill"].POST;
    const response = await handler();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("shutting down");
  });

  test("response has correct content-type", async () => {
    // Mock process.exit to prevent actual termination
    process.exit = mock(() => {}) as unknown as typeof process.exit;

    const handler = settingsRoutes["/api/server/kill"].POST;
    const response = await handler();

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("schedules process.exit after responding", async () => {
    // Mock process.exit to track if it gets called
    const exitMock = mock(() => {});
    process.exit = exitMock as unknown as typeof process.exit;

    const handler = settingsRoutes["/api/server/kill"].POST;
    await handler();

    // process.exit should not be called immediately (it's scheduled with setTimeout)
    expect(exitMock).not.toHaveBeenCalled();

    // Wait for the setTimeout to fire (100ms delay in the implementation)
    await new Promise(resolve => setTimeout(resolve, 150));

    // Now it should have been called
    expect(exitMock).toHaveBeenCalledWith(0);
  });
});
