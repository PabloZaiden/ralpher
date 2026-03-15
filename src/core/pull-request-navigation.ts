/**
 * Helpers for resolving a pull request destination for pushed loops.
 */

import type { CommandExecutor } from "./command-executor";
import type { Loop } from "../types/loop";
import type { PullRequestDestinationResponse } from "../types/api";

export interface PullRequestNavigationGitService {
  getDefaultBranch(directory: string): Promise<string>;
  getRemoteUrl(directory: string, remote?: string): Promise<string>;
}

const GH_UNAVAILABLE_REASON = "GitHub CLI is not available in the loop environment.";
const NO_GITHUB_REMOTE_REASON = "Could not determine a GitHub origin remote for this loop.";

function disabled(disabledReason: string): PullRequestDestinationResponse {
  return {
    enabled: false,
    destinationType: "disabled",
    disabledReason,
  };
}

export function normalizeGitHubRepositoryUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const githubScpMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?\/?$/);
  if (githubScpMatch?.[1]) {
    return `https://github.com/${githubScpMatch[1]}`;
  }

  const sshGithubMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/);
  if (sshGithubMatch?.[1]) {
    return `https://github.com/${sshGithubMatch[1]}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== "github.com") {
      return null;
    }

    const normalizedPath = parsed.pathname
      .replace(/\.git$/u, "")
      .replace(/\/+$/u, "");
    if (!normalizedPath || normalizedPath === "/") {
      return null;
    }

    return `https://github.com${normalizedPath}`;
  } catch {
    return null;
  }
}

export function buildGitHubCompareUrl(
  repositoryUrl: string,
  baseBranch: string,
  headBranch: string,
): string {
  return `${repositoryUrl}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headBranch)}?expand=1`;
}

function getBaseBranch(loop: Loop): string | null {
  const configuredBaseBranch = loop.config.baseBranch?.trim();
  if (configuredBaseBranch) {
    return configuredBaseBranch;
  }

  const originalBranch = loop.state.git?.originalBranch?.trim();
  if (originalBranch) {
    return originalBranch;
  }

  return null;
}

export async function resolvePullRequestDestination(
  loop: Loop,
  directory: string,
  executor: CommandExecutor,
  git: PullRequestNavigationGitService,
): Promise<PullRequestDestinationResponse> {
  const workingBranch = loop.state.git?.workingBranch?.trim();
  if (!workingBranch) {
    return disabled("This loop does not have a working branch to compare.");
  }

  const ghVersionResult = await executor.exec("gh", ["--version"], { cwd: directory, timeout: 5000 });
  if (!ghVersionResult.success) {
    return disabled(GH_UNAVAILABLE_REASON);
  }

  const prViewResult = await executor.exec(
    "gh",
    ["pr", "view", "--json", "url", "-q", ".url"],
    { cwd: directory, timeout: 10000 },
  );
  const existingPrUrl = prViewResult.stdout.trim();
  if (prViewResult.success && existingPrUrl.length > 0) {
    return {
      enabled: true,
      destinationType: "existing_pr",
      url: existingPrUrl,
    };
  }

  const remoteUrl = await git.getRemoteUrl(directory, "origin");
  const repositoryUrl = normalizeGitHubRepositoryUrl(remoteUrl);
  if (!repositoryUrl) {
    return disabled(NO_GITHUB_REMOTE_REASON);
  }

  const baseBranch = getBaseBranch(loop) ?? await git.getDefaultBranch(directory);
  return {
    enabled: true,
    destinationType: "create_pr",
    url: buildGitHubCompareUrl(repositoryUrl, baseBranch, workingBranch),
  };
}

