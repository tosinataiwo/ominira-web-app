import { describe, expect, test } from "bun:test";
import {
  DISCONNECTED_GRACE_MS,
  INITIAL_RECOVERY,
  RESTART_TIMEOUT_MS,
  nextRecovery,
  peerHealth,
  type Recovery,
  type RecoveryInput,
} from "./recovery";

const state = (s: RTCPeerConnectionState): RecoveryInput => ({ kind: "state", state: s });
const timeout: RecoveryInput = { kind: "timeout" };

/** Runs inputs from a start, returning every step. */
function run(inputs: RecoveryInput[], polite = false, start: Recovery = INITIAL_RECOVERY) {
  let recovery = start;
  return inputs.map((input) => {
    const step = nextRecovery(recovery, input, polite);
    recovery = step.recovery;
    return step;
  });
}

describe("nextRecovery", () => {
  test("connecting → connected clears the timer", () => {
    const [step] = run([state("connected")]);
    expect(step.recovery.phase).toBe("connected");
    expect(step.timeoutMs).toBeNull();
  });

  test("never connecting closes at the connect timeout", () => {
    const [a, b] = run([state("connecting"), timeout]);
    expect(a.close).toBe(false);
    expect(b.close).toBe(true);
  });

  test("disconnected waits 3 s, then the impolite side restarts ICE", () => {
    const steps = run([state("connected"), state("disconnected"), timeout]);
    expect(steps[1].timeoutMs).toBe(DISCONNECTED_GRACE_MS);
    expect(steps[1].restartIce).toBe(false);
    expect(steps[2].restartIce).toBe(true);
    expect(steps[2].recovery.phase).toBe("restarting");
    expect(steps[2].timeoutMs).toBe(RESTART_TIMEOUT_MS);
  });

  test("the polite side runs the same clock but leaves the restart to the other", () => {
    const steps = run([state("connected"), state("disconnected"), timeout], true);
    expect(steps[2].restartIce).toBe(false);
    expect(steps[2].recovery.phase).toBe("restarting");
  });

  test("disconnected that recovers on its own does nothing more", () => {
    const steps = run([state("connected"), state("disconnected"), state("connected")]);
    expect(steps[2]).toEqual({ recovery: { phase: "connected", restarted: false }, restartIce: false, close: false, timeoutMs: null });
  });

  test("failed restarts once; failing again closes", () => {
    const steps = run([state("connected"), state("failed"), state("failed")]);
    expect(steps[1].restartIce).toBe(true);
    expect(steps[1].close).toBe(false);
    expect(steps[2].close).toBe(true);
  });

  test("a restart that doesn't reconnect within 10 s closes", () => {
    const steps = run([state("connected"), state("failed"), timeout]);
    expect(steps[2].close).toBe(true);
  });

  test("reconnecting after a restart allows another restart later", () => {
    const steps = run([state("connected"), state("failed"), state("connected"), state("failed")]);
    expect(steps[3].restartIce).toBe(true);
    expect(steps[3].close).toBe(false);
  });

  test("a timeout while connected (stale timer) does nothing", () => {
    const [, step] = run([state("connected"), timeout]);
    expect(step.close).toBe(false);
    expect(step.restartIce).toBe(false);
  });

  test("closed is ignored (we closed it)", () => {
    const [, step] = run([state("connected"), state("closed")]);
    expect(step.close).toBe(false);
  });
});

describe("peerHealth", () => {
  test("disconnected and restarting read as reconnecting", () => {
    expect(peerHealth({ phase: "connecting", restarted: false })).toBe("connecting");
    expect(peerHealth({ phase: "connected", restarted: false })).toBe("connected");
    expect(peerHealth({ phase: "disconnected", restarted: false })).toBe("reconnecting");
    expect(peerHealth({ phase: "restarting", restarted: true })).toBe("reconnecting");
  });
});
