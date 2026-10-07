// A peer's failure and recovery rules (spec §8.8), pure so they're unit
// tested; peer.ts feeds it connection states and timeouts and carries out
// what it returns.
//
//   connecting ──(20 s, never connected)──▶ close
//   connected → disconnected ──(3 s)──▶ restartIce
//   * → failed ──▶ restartIce once ──(10 s, still not connected)──▶ close
//
// Only the impolite side restarts ICE (its offer carries the restart), so
// the two sides don't both offer; the polite side runs the same clock and
// waits for it. A closed peer that's still desired is rebuilt by the mesh.

export const CONNECT_TIMEOUT_MS = 20_000;
export const DISCONNECTED_GRACE_MS = 3_000;
export const RESTART_TIMEOUT_MS = 10_000;

export type Recovery = {
  phase: "connecting" | "connected" | "disconnected" | "restarting";
  /** ICE has been restarted since the last time it was connected. */
  restarted: boolean;
};

export const INITIAL_RECOVERY: Recovery = { phase: "connecting", restarted: false };

export type RecoveryInput = { kind: "state"; state: RTCPeerConnectionState } | { kind: "timeout" };

export type RecoveryStep = {
  recovery: Recovery;
  restartIce: boolean;
  close: boolean;
  /** Set the one timer to this (ms), clear it (null), or leave it (undefined). */
  timeoutMs?: number | null;
};

/** What the UI shows for a peer: `reconnecting` is spec §10's speaker dropped. */
export function peerHealth(recovery: Recovery): "connecting" | "connected" | "reconnecting" {
  return recovery.phase === "connecting" || recovery.phase === "connected" ? recovery.phase : "reconnecting";
}

export function nextRecovery(recovery: Recovery, input: RecoveryInput, polite: boolean): RecoveryStep {
  const stay: RecoveryStep = { recovery, restartIce: false, close: false };
  const restart: RecoveryStep = {
    recovery: { phase: "restarting", restarted: true },
    restartIce: !polite,
    close: false,
    timeoutMs: RESTART_TIMEOUT_MS,
  };
  const close: RecoveryStep = { recovery, restartIce: false, close: true, timeoutMs: null };

  if (input.kind === "timeout") {
    switch (recovery.phase) {
      case "connecting":
      case "restarting":
        return close;
      case "disconnected":
        return restart;
      case "connected":
        return stay;
    }
  }

  switch (input.state) {
    case "connected":
      return { recovery: { phase: "connected", restarted: false }, restartIce: false, close: false, timeoutMs: null };
    case "disconnected":
      return recovery.phase === "connected"
        ? { recovery: { ...recovery, phase: "disconnected" }, restartIce: false, close: false, timeoutMs: DISCONNECTED_GRACE_MS }
        : stay;
    case "failed":
      return recovery.restarted ? close : restart;
    default:
      // new / connecting: the running timer decides; closed is our own doing.
      return stay;
  }
}
