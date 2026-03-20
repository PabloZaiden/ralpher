import { useId, useState, type FormEvent } from "react";
import { useSshServers, useToast } from "../../hooks";
import { Badge, Button, PASSWORD_INPUT_PROPS } from "../common";
import type { ShellRoute } from "./shell-types";
import { ShellPanel, InlineField } from "./shell-panel";

export function SshServerComposer({
  headerOffsetClassName,
  onCancel,
  onNavigate,
  onCreateServer,
}: {
  headerOffsetClassName?: string;
  onCancel: () => void;
  onNavigate: (route: ShellRoute) => void;
  onCreateServer: ReturnType<typeof useSshServers>["createServer"];
}) {
  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [repositoriesBasePath, setRepositoriesBasePath] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !address.trim() || !username.trim()) {
      toast.error("Name, address, and username are required.");
      return;
    }

    setSubmitting(true);
    try {
      const server = await onCreateServer(
        {
          name: name.trim(),
          address: address.trim(),
          username: username.trim(),
          repositoriesBasePath: repositoriesBasePath.trim() || undefined,
        },
        password.trim() || undefined,
      );
      if (!server) {
        toast.error("Failed to create SSH server");
        return;
      }
      onNavigate({ view: "ssh-server", serverId: server.config.id });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ShellPanel
      eyebrow="SSH server"
      title="Register a standalone SSH server"
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      badges={(
        <Badge variant="info" size="sm">Standalone SSH</Badge>
      )}
      actions={(
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="sm" loading={submitting}>
            Create SSH Server
          </Button>
        </>
      )}
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 lg:grid-cols-2">
          <InlineField id="server-name" label="Server name" value={name} onChange={setName} placeholder="Production host" required />
          <InlineField id="server-address" label="Address" value={address} onChange={setAddress} placeholder="server.example.com" required />
          <InlineField id="server-username" label="Username" value={username} onChange={setUsername} placeholder="ubuntu" required />
          <InlineField
            id="server-repositories-base-path"
            label="Repositories base path"
            value={repositoriesBasePath}
            onChange={setRepositoriesBasePath}
            placeholder="/workspaces"
            help="Default base path for cloning repositories during automatic provisioning."
          />
          <InlineField
            id="server-password"
            label="Client-only password"
            value={password}
            onChange={setPassword}
            placeholder="Optional"
            type="password"
            help="Stored encrypted in this client to streamline persistent standalone sessions."
            inputProps={PASSWORD_INPUT_PROPS}
          />
        </div>
      </form>
    </ShellPanel>
  );
}
