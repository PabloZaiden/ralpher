import { posix as pathPosix } from "node:path";
import { backendManager } from "./backend-manager";
import type { CommandExecutor, CommandResult } from "./command-executor";
import { provisioningEventEmitter } from "./event-emitter";
import { GitService } from "./git-service";
import { createLogger } from "./logger";
import { sshServerManager } from "./ssh-server-manager";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceByDirectoryAndServerSettings,
} from "../persistence/workspaces";
import type {
  AgentProvider,
  DevboxPublishedPort,
  DevboxStatusResult,
  ProvisioningJob,
  ProvisioningJobError,
  ProvisioningJobSnapshot,
  ProvisioningLogEntry,
  ProvisioningStep,
  ServerSettings,
} from "../types";

const log = createLogger("core:provisioning-manager");
const DEFAULT_JOB_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_MAX_LOG_ENTRIES = 2000;
const DEVBOX_UP_TIMEOUT_MS = 15 * 60 * 1000;
const GIT_CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

interface StartProvisioningJobOptions {
  name: string;
  sshServerId: string;
  repoUrl: string;
  basePath: string;
  provider: AgentProvider;
  password?: string;
}

interface ProvisioningJobRecord {
  job: ProvisioningJob;
  logs: ProvisioningLogEntry[];
  abortController: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

class ProvisioningFailedError extends Error {
  constructor(
    readonly code: string,
    readonly step: ProvisioningStep,
    message: string,
  ) {
    super(message);
  }
}

class ProvisioningCancelledError extends Error {}

function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
}

export function extractRepoName(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Repository URL is required");
  }

  let pathValue = trimmed;
  if (trimmed.includes("://")) {
    pathValue = new URL(trimmed).pathname;
  } else {
    const scpLikeMatch = trimmed.match(/^[^@]+@[^:]+:(.+)$/);
    if (scpLikeMatch?.[1]) {
      pathValue = scpLikeMatch[1];
    }
  }

  const segments = pathValue.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1]?.replace(/\.git$/i, "");
  if (!lastSegment) {
    throw new Error(`Could not derive repository name from URL: ${url}`);
  }

  return lastSegment;
}

export function parseDevboxStatusOutput(output: string): DevboxStatusResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("devbox status did not return valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("devbox status did not return an object");
  }

  const record = parsed as Record<string, unknown>;
  const publishedPorts = record["publishedPorts"];
  const normalizedPublishedPorts = (
    publishedPorts && typeof publishedPorts === "object" && !Array.isArray(publishedPorts)
      ? Object.fromEntries(
          Object.entries(publishedPorts).map(([key, value]) => {
            const entries = Array.isArray(value)
              ? value.flatMap((item) => {
                  if (!item || typeof item !== "object" || Array.isArray(item)) {
                    return [];
                  }

                  const candidate = item as Record<string, unknown>;
                  if (typeof candidate["hostPort"] !== "number") {
                    return [];
                  }

                  return [{
                    hostIp: typeof candidate["hostIp"] === "string" ? candidate["hostIp"] : "",
                    hostPort: candidate["hostPort"],
                  } satisfies DevboxPublishedPort];
                })
              : [];
            return [key, entries];
          }),
        )
      : undefined
  );

  return {
    running: record["running"] === true,
    port: typeof record["port"] === "number" ? record["port"] : null,
    password: typeof record["password"] === "string" ? record["password"] : null,
    workdir: typeof record["workdir"] === "string" ? record["workdir"] : null,
    sshUser: typeof record["sshUser"] === "string" ? record["sshUser"] : null,
    sshPort: typeof record["sshPort"] === "number" ? record["sshPort"] : null,
    remoteUser: typeof record["remoteUser"] === "string" ? record["remoteUser"] : null,
    hasCredentialFile: record["hasCredentialFile"] === true,
    credentialPath: typeof record["credentialPath"] === "string" ? record["credentialPath"] : null,
    publishedPorts: normalizedPublishedPorts,
  };
}

export function parseDevboxCredentialContent(content: string): {
  username?: string;
  password?: string;
} {
  const trimmed = content.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        username:
          typeof parsed["username"] === "string"
            ? parsed["username"]
            : typeof parsed["user"] === "string"
              ? parsed["user"]
              : typeof parsed["sshUser"] === "string"
                ? parsed["sshUser"]
                : undefined,
        password:
          typeof parsed["password"] === "string"
            ? parsed["password"]
            : typeof parsed["pass"] === "string"
              ? parsed["pass"]
              : undefined,
      };
    } catch {
      // Fall through to line-based parsing.
    }
  }

  const result: { username?: string; password?: string } = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      if (!result.password && line.trim()) {
        result.password = line.trim();
      }
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!rawValue) {
      continue;
    }

    if (!result.username && (key === "username" || key === "user" || key === "ssh_user")) {
      result.username = rawValue;
      continue;
    }
    if (!result.password && (key === "password" || key === "pass" || key === "ssh_password")) {
      result.password = rawValue;
    }
  }

  return result;
}

function getPublishedPortFallback(status: DevboxStatusResult): number | undefined {
  if (!status.publishedPorts) {
    return undefined;
  }

  for (const entries of Object.values(status.publishedPorts)) {
    const firstEntry = entries.find((entry) => typeof entry.hostPort === "number");
    if (firstEntry) {
      return firstEntry.hostPort;
    }
  }

  return undefined;
}

function buildError(code: string, step: ProvisioningStep, message: string): ProvisioningJobError {
  return { code, step, message };
}

export class ProvisioningManager {
  private readonly jobs = new Map<string, ProvisioningJobRecord>();

  constructor(
    private readonly jobRetentionMs: number = DEFAULT_JOB_RETENTION_MS,
    private readonly maxLogEntries: number = DEFAULT_MAX_LOG_ENTRIES,
  ) {}

  async startJob(options: StartProvisioningJobOptions): Promise<ProvisioningJobSnapshot> {
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const record: ProvisioningJobRecord = {
      job: {
        config: {
          id: jobId,
          name: options.name.trim(),
          sshServerId: options.sshServerId.trim(),
          repoUrl: options.repoUrl.trim(),
          basePath: options.basePath.trim(),
          provider: options.provider,
          createdAt: now,
        },
        state: {
          status: "pending",
          updatedAt: now,
        },
      },
      logs: [],
      abortController: new AbortController(),
    };

    this.jobs.set(jobId, record);
    this.emitStarted(record.job);

    void this.runJob(record, options.password).catch((error) => {
      log.error("Provisioning job crashed unexpectedly", {
        provisioningJobId: record.job.config.id,
        error: String(error),
      });
    });

    return await this.getSnapshotOrThrow(jobId);
  }

  async getJobSnapshot(jobId: string): Promise<ProvisioningJobSnapshot | null> {
    const record = this.jobs.get(jobId);
    if (!record) {
      return null;
    }
    return await this.buildSnapshot(record);
  }

  getJobLogs(jobId: string): ProvisioningLogEntry[] | null {
    const record = this.jobs.get(jobId);
    return record ? [...record.logs] : null;
  }

  async cancelJob(jobId: string): Promise<ProvisioningJobSnapshot | null> {
    const record = this.jobs.get(jobId);
    if (!record) {
      return null;
    }

    if (record.job.state.status === "running" || record.job.state.status === "pending") {
      record.abortController.abort();
      this.appendSystemLog(record, "Cancellation requested", record.job.state.currentStep);
    }

    return await this.buildSnapshot(record);
  }

  resetForTesting(): void {
    for (const record of this.jobs.values()) {
      record.abortController.abort();
      if (record.cleanupTimer) {
        clearTimeout(record.cleanupTimer);
      }
    }
    this.jobs.clear();
  }

  private async runJob(record: ProvisioningJobRecord, password?: string): Promise<void> {
    let createdWorkspaceId: string | undefined;

    try {
      const { server, executor } = await sshServerManager.getCommandExecutor(
        record.job.config.sshServerId,
        password,
      );
      const git = GitService.withExecutor(executor);

      this.setStep(record, "verify_devbox", "Checking for devbox");
      await this.runCommand(record, executor, {
        step: "verify_devbox",
        label: "Checking devbox availability",
        command: "bash",
        args: ["-lc", "command -v devbox >/dev/null 2>&1"],
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        errorCode: "devbox_not_found",
        errorMessage: "Devbox is not installed or not available on PATH",
        captureStdout: false,
      });

      this.setStep(record, "prepare_directory", "Preparing remote base directory");
      await this.runCommand(record, executor, {
        step: "prepare_directory",
        label: `Ensuring base path ${record.job.config.basePath}`,
        command: "mkdir",
        args: ["-p", record.job.config.basePath],
      });

      this.setStep(record, "clone_repo", "Preparing repository checkout");
      const repoName = extractRepoName(record.job.config.repoUrl);
      const targetDirectory = pathPosix.join(record.job.config.basePath, repoName);
      this.updateState(record, {
        targetDirectory,
      });

      const targetExists = await executor.directoryExists(targetDirectory);
      if (!targetExists) {
        await this.runCommand(record, executor, {
          step: "clone_repo",
          label: `Cloning repository into ${targetDirectory}`,
          command: "git",
          args: ["clone", record.job.config.repoUrl, targetDirectory],
          timeout: GIT_CLONE_TIMEOUT_MS,
          streamOutput: true,
          errorCode: "clone_failed",
          errorMessage: "Failed to clone repository",
        });
      } else {
        const existingRepo = await git.isGitRepo(targetDirectory);
        if (!existingRepo) {
          throw new ProvisioningFailedError(
            "clone_conflict",
            "clone_repo",
            `Target directory already exists and is not a git repository: ${targetDirectory}`,
          );
        }

        const remoteUrlResult = await executor.exec(
          "git",
          ["remote", "get-url", "origin"],
          {
            cwd: targetDirectory,
            signal: record.abortController.signal,
          },
        );
        this.throwIfCancelled(record);
        if (!remoteUrlResult.success) {
          throw new ProvisioningFailedError(
            "clone_conflict",
            "clone_repo",
            `Target directory already exists but its origin remote could not be verified: ${targetDirectory}`,
          );
        }

        if (normalizeRepoUrl(remoteUrlResult.stdout) !== normalizeRepoUrl(record.job.config.repoUrl)) {
          throw new ProvisioningFailedError(
            "clone_conflict",
            "clone_repo",
            `Target directory already exists with a different origin remote: ${targetDirectory}`,
          );
        }

        this.appendSystemLog(record, `Reusing existing checkout at ${targetDirectory}`, "clone_repo");
      }

      this.setStep(record, "devbox_up", "Starting devbox");
      await this.runCommand(record, executor, {
        step: "devbox_up",
        label: "Running devbox up",
        command: "devbox",
        args: ["up"],
        cwd: targetDirectory,
        timeout: DEVBOX_UP_TIMEOUT_MS,
        streamOutput: true,
        errorCode: "devbox_up_failed",
        errorMessage: "Failed to start devbox",
      });

      this.setStep(record, "devbox_status", "Reading devbox status");
      const statusResult = await this.runCommand(record, executor, {
        step: "devbox_status",
        label: "Reading devbox status",
        command: "devbox",
        args: ["status"],
        cwd: targetDirectory,
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        errorCode: "invalid_devbox_status",
        errorMessage: "Failed to read devbox status",
        captureStdout: false,
      });
      const status = parseDevboxStatusOutput(statusResult.stdout);
      if (!status.running) {
        throw new ProvisioningFailedError(
          "invalid_devbox_status",
          "devbox_status",
          "devbox status reported that the environment is not running",
        );
      }

      let devboxCredential = parseDevboxCredentialContent("");
      if (!status.password && status.hasCredentialFile && status.credentialPath) {
        const credentialContent = await executor.readFile(status.credentialPath);
        if (credentialContent) {
          devboxCredential = parseDevboxCredentialContent(credentialContent);
        }
      }

      const resolvedDirectory = status.workdir?.trim();
      if (!resolvedDirectory) {
        throw new ProvisioningFailedError(
          "invalid_devbox_status",
          "devbox_status",
          "devbox status did not include a workdir value",
        );
      }

      const resolvedPort = status.sshPort ?? status.port ?? getPublishedPortFallback(status);
      if (!resolvedPort) {
        throw new ProvisioningFailedError(
          "invalid_devbox_status",
          "devbox_status",
          "devbox status did not include SSH port information",
        );
      }

      const resolvedUsername = status.sshUser?.trim()
        || devboxCredential.username?.trim()
        || status.remoteUser?.trim()
        || server.username.trim();
      if (!resolvedUsername) {
        throw new ProvisioningFailedError(
          "invalid_devbox_status",
          "devbox_status",
          "devbox status did not include SSH username information",
        );
      }

      const resolvedPassword = status.password?.trim() || devboxCredential.password?.trim();
      if (!resolvedPassword) {
        throw new ProvisioningFailedError(
          "invalid_devbox_status",
          "devbox_status",
          "Could not determine the devbox SSH password from devbox status or credential file",
        );
      }

      const serverSettings: ServerSettings = {
        agent: {
          provider: record.job.config.provider,
          transport: "ssh",
          hostname: server.address,
          port: resolvedPort,
          username: resolvedUsername,
          password: resolvedPassword,
        },
      };

      this.updateState(record, {
        resolvedDirectory,
        serverSettings,
      });
      this.appendSystemLog(
        record,
        `Resolved devbox SSH endpoint ${resolvedUsername}@${server.address}:${resolvedPort}`,
        "devbox_status",
      );

      this.setStep(record, "create_workspace", "Creating workspace record");
      const existingWorkspace = await getWorkspaceByDirectoryAndServerSettings(
        resolvedDirectory,
        serverSettings,
      );
      if (existingWorkspace) {
        this.updateState(record, {
          workspaceId: existingWorkspace.id,
          workspaceAction: "reused",
        });
        this.appendSystemLog(
          record,
          `Reusing existing workspace ${existingWorkspace.name}`,
          "create_workspace",
        );
      } else {
        const now = new Date().toISOString();
        const workspace = {
          id: crypto.randomUUID(),
          name: record.job.config.name,
          directory: resolvedDirectory,
          serverSettings,
          createdAt: now,
          updatedAt: now,
        };
        await createWorkspace(workspace);
        createdWorkspaceId = workspace.id;
        this.updateState(record, {
          workspaceId: workspace.id,
          workspaceAction: "created",
        });
        this.appendSystemLog(record, `Created workspace ${workspace.name}`, "create_workspace");
      }

      this.setStep(record, "test_connection", "Testing workspace connection");
      const connectionResult = await backendManager.testConnection(serverSettings, resolvedDirectory);
      if (!connectionResult.success) {
        throw new ProvisioningFailedError(
          "connection_test_failed",
          "test_connection",
          connectionResult.error ?? "Workspace connection test failed",
        );
      }

      this.setStep(record, "workspace_ready");
      const completedAt = new Date().toISOString();
      record.job.state = {
        ...record.job.state,
        status: "completed",
        completedAt,
        updatedAt: completedAt,
      };
      this.appendSystemLog(
        record,
        record.job.state.workspaceAction === "reused"
          ? `Workspace connection test succeeded. Existing workspace ${record.job.config.name} is ready.`
          : `Workspace connection test succeeded. Workspace ${record.job.config.name} was created successfully and is ready.`,
        "workspace_ready",
      );
      this.emitCompleted(record.job);
      this.scheduleCleanup(record);
    } catch (error) {
      const cancelled = error instanceof ProvisioningCancelledError || record.abortController.signal.aborted;
      const failure = cancelled
        ? buildError(
            "cancelled",
            record.job.state.currentStep ?? "verify_devbox",
            "Provisioning job was cancelled",
          )
        : error instanceof ProvisioningFailedError
          ? buildError(error.code, error.step, error.message)
          : buildError(
              "provisioning_failed",
              record.job.state.currentStep ?? "verify_devbox",
              String(error),
            );

      if (createdWorkspaceId) {
        try {
          await deleteWorkspace(createdWorkspaceId);
          if (record.job.state.workspaceId === createdWorkspaceId) {
            this.updateState(record, {
              workspaceId: undefined,
              workspaceAction: undefined,
            });
          }
          this.appendSystemLog(
            record,
            "Removed the partially created workspace after provisioning failure",
            "create_workspace",
          );
        } catch (cleanupError) {
          log.warn("Failed to remove partially created workspace after provisioning failure", {
            provisioningJobId: record.job.config.id,
            workspaceId: createdWorkspaceId,
            error: String(cleanupError),
          });
        }
      }

      const completedAt = new Date().toISOString();
      record.job.state = {
        ...record.job.state,
        status: cancelled ? "cancelled" : "failed",
        error: failure,
        completedAt,
        updatedAt: completedAt,
      };
      this.appendSystemLog(record, failure.message, failure.step);
      if (cancelled) {
        this.emitCancelled(record.job);
      } else {
        this.emitFailed(record.job, failure);
      }
      this.scheduleCleanup(record);
    }
  }

  private async buildSnapshot(record: ProvisioningJobRecord): Promise<ProvisioningJobSnapshot> {
    const workspace = record.job.state.workspaceId
      ? await getWorkspace(record.job.state.workspaceId)
      : null;
    return {
      job: structuredClone(record.job),
      logs: [...record.logs],
      ...(workspace ? { workspace } : {}),
    };
  }

  private async getSnapshotOrThrow(jobId: string): Promise<ProvisioningJobSnapshot> {
    const snapshot = await this.getJobSnapshot(jobId);
    if (!snapshot) {
      throw new Error(`Provisioning job not found: ${jobId}`);
    }
    return snapshot;
  }

  private throwIfCancelled(record: ProvisioningJobRecord): void {
    if (record.abortController.signal.aborted) {
      throw new ProvisioningCancelledError("Provisioning job was cancelled");
    }
  }

  private updateState(
    record: ProvisioningJobRecord,
    updates: Partial<ProvisioningJob["state"]>,
  ): void {
    record.job.state = {
      ...record.job.state,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
  }

  private setStep(record: ProvisioningJobRecord, step: ProvisioningStep, message?: string): void {
    this.updateState(record, {
      status: "running",
      currentStep: step,
      startedAt: record.job.state.startedAt ?? new Date().toISOString(),
    });
    if (message) {
      this.appendSystemLog(record, message, step);
    }
    provisioningEventEmitter.emit({
      type: "provisioning.step",
      provisioningJobId: record.job.config.id,
      job: structuredClone(record.job),
      step,
      message,
      timestamp: record.job.state.updatedAt,
    });
  }

  private appendSystemLog(
    record: ProvisioningJobRecord,
    text: string,
    step?: ProvisioningStep,
  ): void {
    this.appendLog(record, "system", text, step);
  }

  private appendLog(
    record: ProvisioningJobRecord,
    source: ProvisioningLogEntry["source"],
    text: string,
    step?: ProvisioningStep,
  ): void {
    if (!text) {
      return;
    }

    const entry: ProvisioningLogEntry = {
      id: crypto.randomUUID(),
      source,
      text,
      timestamp: new Date().toISOString(),
      ...(step ? { step } : {}),
    };
    record.logs.push(entry);
    if (record.logs.length > this.maxLogEntries) {
      record.logs.splice(0, record.logs.length - this.maxLogEntries);
    }
    provisioningEventEmitter.emit({
      type: "provisioning.output",
      provisioningJobId: record.job.config.id,
      entry,
      timestamp: entry.timestamp,
    });
  }

  private emitStarted(job: ProvisioningJob): void {
    provisioningEventEmitter.emit({
      type: "provisioning.started",
      provisioningJobId: job.config.id,
      job: structuredClone(job),
      timestamp: job.state.updatedAt,
    });
  }

  private emitCompleted(job: ProvisioningJob): void {
    provisioningEventEmitter.emit({
      type: "provisioning.completed",
      provisioningJobId: job.config.id,
      job: structuredClone(job),
      timestamp: job.state.updatedAt,
    });
  }

  private emitFailed(job: ProvisioningJob, error: ProvisioningJobError): void {
    provisioningEventEmitter.emit({
      type: "provisioning.failed",
      provisioningJobId: job.config.id,
      job: structuredClone(job),
      error,
      timestamp: job.state.updatedAt,
    });
  }

  private emitCancelled(job: ProvisioningJob): void {
    provisioningEventEmitter.emit({
      type: "provisioning.cancelled",
      provisioningJobId: job.config.id,
      job: structuredClone(job),
      timestamp: job.state.updatedAt,
    });
  }

  private scheduleCleanup(record: ProvisioningJobRecord): void {
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
    }

    record.cleanupTimer = setTimeout(() => {
      this.jobs.delete(record.job.config.id);
    }, this.jobRetentionMs);
  }

  private async runCommand(
    record: ProvisioningJobRecord,
    executor: CommandExecutor,
    options: {
      step: ProvisioningStep;
      label: string;
      command: string;
      args: string[];
      cwd?: string;
      timeout?: number;
      streamOutput?: boolean;
      errorCode?: string;
      errorMessage?: string;
      captureStdout?: boolean;
      captureStderr?: boolean;
    },
  ): Promise<CommandResult> {
    this.appendSystemLog(record, options.label, options.step);

    const result = await executor.exec(options.command, options.args, {
      cwd: options.cwd,
      timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
      signal: record.abortController.signal,
      ...(options.streamOutput
        ? {
            onStdoutChunk: (chunk: string) => this.appendLog(record, "stdout", chunk, options.step),
            onStderrChunk: (chunk: string) => this.appendLog(record, "stderr", chunk, options.step),
          }
        : {}),
    });
    this.throwIfCancelled(record);

    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim() || options.errorMessage || "Command failed";
      throw new ProvisioningFailedError(
        options.errorCode ?? "command_failed",
        options.step,
        options.errorMessage ? `${options.errorMessage}: ${detail}` : detail,
      );
    }

    if (!options.streamOutput) {
      if (options.captureStdout !== false && result.stdout.trim()) {
        this.appendLog(record, "stdout", result.stdout, options.step);
      }
      if (options.captureStderr !== false && result.stderr.trim()) {
        this.appendLog(record, "stderr", result.stderr, options.step);
      }
    }

    return result;
  }
}

export const provisioningManager = new ProvisioningManager();
