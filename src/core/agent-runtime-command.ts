import type { AgentProvider } from "../types/settings";

/**
 * Build the default ACP CLI command for a provider.
 */
export function getProviderAcpCommand(provider: AgentProvider): { command: string; args: string[] } {
  if (provider === "copilot") {
    return { command: "copilot", args: ["--yolo", "--acp"] };
  }
  return { command: "opencode", args: ["acp"] };
}
