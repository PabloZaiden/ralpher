import type { useSshSession } from "../../hooks";

export type SshSession = NonNullable<ReturnType<typeof useSshSession>["session"]>;

export function isStandaloneSession(session: SshSession): session is Extract<
  SshSession,
  { config: { sshServerId: string } }
> {
  return "sshServerId" in session.config;
}
