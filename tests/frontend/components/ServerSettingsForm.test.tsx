/**
 * Tests for the ServerSettingsForm component.
 */

import { describe, test, expect, mock } from "bun:test";
import { ServerSettingsForm } from "@/components/ServerSettingsForm";
import { renderWithUser, waitFor } from "../helpers/render";

describe("ServerSettingsForm", () => {
  test("emits stdio settings by default without legacy fields", async () => {
    const onChange = mock();
    const { queryByLabelText } = renderWithUser(
      <ServerSettingsForm onChange={onChange} />
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const [settings, isValid] = onChange.mock.calls.at(-1) as [
      { agent: { provider: string; transport: string } },
      boolean,
    ];

    expect(settings).toEqual({
      agent: {
        provider: "opencode",
        transport: "stdio",
      },
    });
    expect(isValid).toBe(true);
    expect(queryByLabelText("Hostname")).not.toBeInTheDocument();
    expect(queryByLabelText("Port")).not.toBeInTheDocument();
  });

  test("shows SSH fields and emits SSH settings when transport changes", async () => {
    const onChange = mock();
    const { getByLabelText, user } = renderWithUser(
      <ServerSettingsForm onChange={onChange} />
    );

    const transportSelect = getByLabelText("Transport") as HTMLSelectElement;
    await user.selectOptions(transportSelect, "ssh");

    const hostInput = getByLabelText("Hostname") as HTMLInputElement;
    const portInput = getByLabelText("Port") as HTMLInputElement;
    const userInput = getByLabelText("Username (optional)") as HTMLInputElement;
    const passInput = getByLabelText("Password (optional)") as HTMLInputElement;

    await user.clear(hostInput);
    await user.type(hostInput, "remote-host");
    await user.clear(portInput);
    await user.type(portInput, "2222");
    await user.type(userInput, "vscode");
    await user.type(passInput, "secret");

    const [settings, isValid] = onChange.mock.calls.at(-1) as [
      {
        agent: {
          provider: string;
          transport: string;
          hostname: string;
          port: number;
          username?: string;
          password?: string;
        };
      },
      boolean,
    ];

    expect(settings).toEqual({
      agent: {
        provider: "opencode",
        transport: "ssh",
        hostname: "remote-host",
        port: 2222,
        username: "vscode",
        password: "secret",
      },
    });
    expect(isValid).toBe(true);
  });

  test("remoteOnly defaults to ssh and disables stdio option", async () => {
    const onChange = mock();
    const { getByLabelText } = renderWithUser(
      <ServerSettingsForm onChange={onChange} remoteOnly={true} />
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const transportSelect = getByLabelText("Transport") as HTMLSelectElement;
    const stdioOption = Array.from(transportSelect.options).find((opt) => opt.value === "stdio");
    expect(transportSelect.value).toBe("ssh");
    expect(stdioOption?.disabled).toBe(true);

    const [settings] = onChange.mock.calls.at(-1) as [
      {
        agent: {
          provider: string;
          transport: string;
          hostname?: string;
          port?: number;
        };
      },
    ];
    expect(settings.agent.transport).toBe("ssh");
    expect(settings.agent.hostname).toBe("localhost");
    expect(settings.agent.port).toBe(22);
  });
});
