import { describe, expect, mock, test } from "bun:test";
import { DangerZoneSection } from "@/components/app-settings/danger-zone-section";
import { renderWithUser } from "../helpers/render";

describe("DangerZoneSection", () => {
  test("shows kill server before reset all settings when both actions are available", async () => {
    const onKillServer = mock(() => Promise.resolve(true));
    const onResetAll = mock(() => Promise.resolve(true));

    const { getByRole, user } = renderWithUser(
      <DangerZoneSection
        onKillServer={onKillServer}
        onResetAll={onResetAll}
      />,
    );

    await user.click(getByRole("button", { name: /Danger Zone/ }));

    const killButton = getByRole("button", { name: "Kill server" });
    const resetButton = getByRole("button", { name: "Reset all settings" });

    expect(killButton).toBeInTheDocument();
    expect(resetButton).toBeInTheDocument();
    expect(killButton.compareDocumentPosition(resetButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
