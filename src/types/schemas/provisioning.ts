import { z } from "zod";
import { AgentProviderSchema } from "./workspace";
import { SshCredentialTokenSchema } from "./ssh-server";

const RequiredTrimmedStringSchema = z.string().trim().min(1, "value is required");

export const CreateProvisioningJobRequestSchema = z.object({
  name: RequiredTrimmedStringSchema,
  sshServerId: RequiredTrimmedStringSchema,
  repoUrl: RequiredTrimmedStringSchema,
  basePath: RequiredTrimmedStringSchema,
  provider: AgentProviderSchema.default("copilot"),
  credentialToken: SshCredentialTokenSchema.optional(),
});

export type CreateProvisioningJobRequest = z.infer<typeof CreateProvisioningJobRequestSchema>;
