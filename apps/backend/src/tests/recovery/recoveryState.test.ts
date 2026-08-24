import { describe, expect, it } from "vitest";

import {
  canTransitionRecoveryStatus,
  isRecoveryStatus,
  isTerminalRecoveryStatus
} from "../../recovery/domain/recoveryState.js";

describe("recovery state lifecycle", () => {
  it("recognizes documented recovery statuses", () => {
    expect(isRecoveryStatus("AT_RISK")).toBe(true);
    expect(isRecoveryStatus("UNKNOWN_STATUS")).toBe(false);
  });

  it("allows documented state transitions", () => {
    expect(canTransitionRecoveryStatus("AT_RISK", "ANALYZING")).toBe(true);
    expect(canTransitionRecoveryStatus("ACTION_EXECUTED", "FAILED")).toBe(true);
    expect(canTransitionRecoveryStatus("FAILED", "STOPPED")).toBe(true);
  });

  it("does not allow transitions out of terminal states", () => {
    expect(isTerminalRecoveryStatus("RECOVERED")).toBe(true);
    expect(canTransitionRecoveryStatus("RECOVERED", "ACTION_SELECTED")).toBe(false);
  });
});
