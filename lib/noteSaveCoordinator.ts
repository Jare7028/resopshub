export type NoteSaveCoordinatorCompletionInput = {
  requestVersion: number;
  latestScheduledVersion: number;
  lastCommittedVersion: number;
};

export type NoteSaveCoordinatorCompletionResult = {
  shouldAcknowledge: boolean;
  nextLastCommittedVersion: number;
};

export type NoteSavePendingInput = {
  hasDebounceTimer: boolean;
  inFlightSaveCount: number;
  lastCommittedVersion: number;
  latestScheduledVersion: number;
};

export type NoteSaveActiveInput = {
  hasDebounceTimer: boolean;
  inFlightSaveCount: number;
};

export function getNextSaveVersion(currentVersion: number) {
  return Math.max(0, Math.floor(Number(currentVersion) || 0)) + 1;
}

export function resolveSaveCompletion(
  input: NoteSaveCoordinatorCompletionInput
): NoteSaveCoordinatorCompletionResult {
  const requestVersion = Math.max(0, Math.floor(Number(input.requestVersion) || 0));
  const latestScheduledVersion = Math.max(
    0,
    Math.floor(Number(input.latestScheduledVersion) || 0)
  );
  const lastCommittedVersion = Math.max(
    0,
    Math.floor(Number(input.lastCommittedVersion) || 0)
  );
  const shouldAcknowledge = requestVersion === latestScheduledVersion;
  return {
    shouldAcknowledge,
    nextLastCommittedVersion: shouldAcknowledge
      ? Math.max(lastCommittedVersion, requestVersion)
      : lastCommittedVersion,
  };
}

export function shouldSurfaceSaveError(input: {
  requestVersion: number;
  latestScheduledVersion: number;
}) {
  const requestVersion = Math.max(0, Math.floor(Number(input.requestVersion) || 0));
  const latestScheduledVersion = Math.max(
    0,
    Math.floor(Number(input.latestScheduledVersion) || 0)
  );
  return requestVersion === latestScheduledVersion;
}

export function hasActiveSaveCoordinatorWork(input: NoteSaveActiveInput) {
  const inFlightSaveCount = Math.max(0, Math.floor(Number(input.inFlightSaveCount) || 0));
  return Boolean(input.hasDebounceTimer) || inFlightSaveCount > 0;
}

export function hasPendingSaveCoordinatorWork(input: NoteSavePendingInput) {
  const lastCommittedVersion = Math.max(
    0,
    Math.floor(Number(input.lastCommittedVersion) || 0)
  );
  const latestScheduledVersion = Math.max(
    0,
    Math.floor(Number(input.latestScheduledVersion) || 0)
  );
  return hasActiveSaveCoordinatorWork(input) || lastCommittedVersion !== latestScheduledVersion;
}
