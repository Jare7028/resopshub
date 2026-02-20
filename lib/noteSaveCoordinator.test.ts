import { describe, expect, it } from "vitest";
import {
  getNextSaveVersion,
  hasPendingSaveCoordinatorWork,
  resolveSaveCompletion,
  shouldSurfaceSaveError,
} from "./noteSaveCoordinator";

describe("noteSaveCoordinator", () => {
  it("ignores stale save completions", () => {
    const result = resolveSaveCompletion({
      requestVersion: 1,
      latestScheduledVersion: 2,
      lastCommittedVersion: 0,
    });

    expect(result.shouldAcknowledge).toBe(false);
    expect(result.nextLastCommittedVersion).toBe(0);
  });

  it("acknowledges latest completion and advances committed version", () => {
    const result = resolveSaveCompletion({
      requestVersion: 3,
      latestScheduledVersion: 3,
      lastCommittedVersion: 1,
    });

    expect(result.shouldAcknowledge).toBe(true);
    expect(result.nextLastCommittedVersion).toBe(3);
  });

  it("surfaces only latest save errors", () => {
    expect(
      shouldSurfaceSaveError({
        requestVersion: 2,
        latestScheduledVersion: 3,
      })
    ).toBe(false);

    expect(
      shouldSurfaceSaveError({
        requestVersion: 3,
        latestScheduledVersion: 3,
      })
    ).toBe(true);
  });

  it("detects pending save work", () => {
    expect(
      hasPendingSaveCoordinatorWork({
        hasDebounceTimer: false,
        inFlightSaveCount: 0,
        lastCommittedVersion: 2,
        latestScheduledVersion: 2,
      })
    ).toBe(false);

    expect(
      hasPendingSaveCoordinatorWork({
        hasDebounceTimer: true,
        inFlightSaveCount: 0,
        lastCommittedVersion: 2,
        latestScheduledVersion: 2,
      })
    ).toBe(true);

    expect(
      hasPendingSaveCoordinatorWork({
        hasDebounceTimer: false,
        inFlightSaveCount: 1,
        lastCommittedVersion: 2,
        latestScheduledVersion: 2,
      })
    ).toBe(true);

    expect(
      hasPendingSaveCoordinatorWork({
        hasDebounceTimer: false,
        inFlightSaveCount: 0,
        lastCommittedVersion: 1,
        latestScheduledVersion: 2,
      })
    ).toBe(true);
  });

  it("increments save versions deterministically", () => {
    expect(getNextSaveVersion(0)).toBe(1);
    expect(getNextSaveVersion(9)).toBe(10);
  });
});
