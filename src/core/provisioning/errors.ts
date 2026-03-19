import type { ProvisioningStep } from "../../types";

export class ProvisioningFailedError extends Error {
  constructor(
    readonly code: string,
    readonly step: ProvisioningStep,
    message: string,
  ) {
    super(message);
  }
}

export class ProvisioningCancelledError extends Error {}
