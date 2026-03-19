import type { AgentProvider, ProvisioningJob, ProvisioningLogEntry } from "../../types";

export interface StartProvisioningJobOptions {
  name: string;
  sshServerId: string;
  repoUrl: string;
  basePath: string;
  provider: AgentProvider;
  password?: string;
}

export interface ProvisioningJobRecord {
  job: ProvisioningJob;
  logs: ProvisioningLogEntry[];
  abortController: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}
