import { describe, expect, test } from "bun:test";

import { buildPersistentSessionBackendProbeCommand } from "../../src/core/ssh-persistent-session";

describe("buildPersistentSessionBackendProbeCommand", () => {
  test("preserves the dtach exit status instead of piping through head", () => {
    const command = buildPersistentSessionBackendProbeCommand();

    expect(command).toContain("command -v dtach >/dev/null 2>&1");
    expect(command).toContain("dtach --help >/dev/null 2>&1");
    expect(command).not.toContain("|");
    expect(command).not.toContain("head -n 1");
  });
});
