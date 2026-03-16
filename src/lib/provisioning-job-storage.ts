const ACTIVE_PROVISIONING_JOB_STORAGE_KEY = "ralpher.activeProvisioningJobId";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getActiveProvisioningJobId(): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(ACTIVE_PROVISIONING_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveProvisioningJobId(jobId: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(ACTIVE_PROVISIONING_JOB_STORAGE_KEY, jobId);
  } catch {
    // Ignore browser storage errors.
  }
}

export function clearActiveProvisioningJobId(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(ACTIVE_PROVISIONING_JOB_STORAGE_KEY);
  } catch {
    // Ignore browser storage errors.
  }
}
