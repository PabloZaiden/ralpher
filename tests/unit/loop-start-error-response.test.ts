import { describe, expect, spyOn, test } from "bun:test";
import { createLogger } from "../../src/core/logger";
import { startErrorResponse } from "../../src/api/loops/helpers";

const loopsLog = createLogger("api:loops");

describe("startErrorResponse", () => {
  test("logs warn for directory-in-use start failures", async () => {
    const warnSpy = spyOn(loopsLog, "warn").mockImplementation(() => undefined);
    const errorSpy = spyOn(loopsLog, "error").mockImplementation(() => undefined);

    try {
      const error = Object.assign(new Error("Directory is already in use"), {
        code: "directory_in_use",
        status: 409,
      });

      const response = startErrorResponse(error, "start_failed", "Failed to start loop", {
        loopId: "loop-123",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "directory_in_use",
        message: "Directory is already in use",
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toBe("Loop start blocked because the directory is already in use");
      expect(warnSpy.mock.calls[0]?.[1]).toEqual({
        loopId: "loop-123",
        error: "Directory is already in use",
      });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("logs error for fallback start failures", async () => {
    const warnSpy = spyOn(loopsLog, "warn").mockImplementation(() => undefined);
    const errorSpy = spyOn(loopsLog, "error").mockImplementation(() => undefined);

    try {
      const response = startErrorResponse(new Error("boom"), "start_failed", "Failed to start loop", {
        loopId: "loop-456",
        planMode: false,
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "start_failed",
        message: "Failed to start loop: Error: boom",
      });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("Loop start failed");
      expect(errorSpy.mock.calls[0]?.[1]).toEqual({
        loopId: "loop-456",
        planMode: false,
        error: "Error: boom",
        fallbackCode: "start_failed",
      });
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
