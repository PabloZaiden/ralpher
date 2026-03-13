/**
 * Browser helpers for building app-local URLs when Ralpher is mounted
 * behind a reverse proxy subpath.
 */

import {
  applyPublicBasePath,
  getPublicBasePathFromPathname,
  normalizePublicBasePath,
} from "../utils/public-base-path";

let configuredPublicBasePath: string | undefined;

export function setConfiguredPublicBasePath(basePath?: string | null): void {
  if (basePath == null) {
    configuredPublicBasePath = undefined;
    return;
  }

  configuredPublicBasePath = normalizePublicBasePath(basePath);
}

export function getConfiguredPublicBasePath(): string {
  if (configuredPublicBasePath !== undefined) {
    return configuredPublicBasePath;
  }

  if (typeof window === "undefined") {
    return "";
  }

  return getPublicBasePathFromPathname(window.location.pathname);
}

export function appPath(path: string): string {
  return applyPublicBasePath(getConfiguredPublicBasePath(), path);
}

export function appAbsoluteUrl(path: string): string {
  if (typeof window === "undefined") {
    return appPath(path);
  }

  return new URL(appPath(path), window.location.origin).toString();
}

export function appWebSocketUrl(path: string): string {
  if (typeof window === "undefined") {
    return appPath(path);
  }

  const url = new URL(appPath(path), window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(appPath(path), init);
}
