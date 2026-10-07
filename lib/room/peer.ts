import { INITIAL_RECOVERY, CONNECT_TIMEOUT_MS, nextRecovery, peerHealth, type Recovery, type RecoveryInput } from "@/lib/room/recovery";
import type { Signal, Signalling } from "@/lib/room/signalling";

// One RTCPeerConnection to one remote session (spec §8.3, §8.4, §8.8).
//
// - Perfect negotiation (MDN): the lower sessionId is polite and rolls back
//   on glare; the impolite side ignores a colliding offer.
// - One audio transceiver per pair. Only a side that sends adds it (when both
//   do, the impolite one), and the other side takes on the one the offer
//   creates. A listener's first mic-on flips it to sendrecv: the peer's one
//   renegotiation. Muting is replaceTrack, never a renegotiation.
// - Non-trickle ICE: a description goes out once gathering completes, or
//   after 2.5 s with what has gathered. One offer and one answer per pair.
// - Negotiation and incoming signals run through one queue, so nothing races.

const GATHER_CAP_MS = 2_500;
/** An offer nobody answered (dropped as early, spec §8.4) is sent again. */
const RESEND_OFFER_MS = 5_000;
/** Opus mono speech (spec §8.5). */
const MAX_BITRATE = 32_000;

/** Perfect negotiation's roles, decided the same way on both sides. */
export function isPolite(sessionId: string, remote: string): boolean {
  return sessionId < remote;
}

export type PeerHealth = ReturnType<typeof peerHealth>;

/** The dev overlay's numbers for one peer (spec §8.10). */
export type PeerStats = {
  state: RTCPeerConnectionState;
  rttMs: number | null;
  jitterMs: number | null;
  packetsLost: number;
  /** Through TURN. */
  relayed: boolean;
};

export type PeerOptions = {
  sessionId: string;
  remote: string;
  /** Presence says the remote has had its mic on (who adds the transceiver). */
  remoteSends: boolean;
  sends: boolean;
  /** The mic track to send, null while muted. */
  track: MediaStreamTrack | null;
  iceServers: RTCIceServer[];
  /** Dev: TURN only, to test the relay (spec §8.4). */
  forceRelay: boolean;
  signalling: Pick<Signalling, "attach" | "send" | "hold">;
  onStream: (stream: MediaStream) => void;
  onHealth: (health: PeerHealth) => void;
  /** Closed itself (failed for good); the mesh rebuilds it if still desired. */
  onClosed: () => void;
};

export class Peer {
  readonly remote: string;
  readonly polite: boolean;
  readonly pc: RTCPeerConnection;
  /** ICE restarts this peer has asked for (the leave beacon, spec §8.10). */
  iceRestarts = 0;
  private transceiver: RTCRtpTransceiver | null = null;
  private sends: boolean;
  private track: MediaStreamTrack | null;
  private queue: Promise<void> = Promise.resolve();
  private makingOffer = false;
  private closed = false;
  private recovery: Recovery = INITIAL_RECOVERY;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private resendTimer: ReturnType<typeof setTimeout> | null = null;
  private restarting = false;
  private lastRemoteOffer: string | null = null;
  private lastAnswer: RTCSessionDescriptionInit | null = null;
  private readonly detach: () => void;

  constructor(private readonly options: PeerOptions) {
    this.remote = options.remote;
    this.polite = isPolite(options.sessionId, options.remote);
    this.sends = options.sends;
    this.track = options.track;
    this.pc = new RTCPeerConnection({
      iceServers: options.iceServers,
      bundlePolicy: "max-bundle",
      iceTransportPolicy: options.forceRelay ? "relay" : "all",
    });

    this.pc.ontrack = ({ track, streams }) => options.onStream(streams[0] ?? new MediaStream([track]));
    this.pc.onnegotiationneeded = () => this.enqueue(() => this.offer());
    this.pc.onconnectionstatechange = () => this.step({ kind: "state", state: this.pc.connectionState });
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === "stable") void this.capBitrate();
    };
    this.detach = options.signalling.attach(options.remote, (signal) => this.enqueue(() => this.receive(signal)));
    this.setTimer(CONNECT_TIMEOUT_MS);
    options.onHealth(peerHealth(this.recovery));

    if (this.sends && (!options.remoteSends || !this.polite)) this.addTransceiver();
  }

  /** Turns true once, on this session's first mic-on (spec §8.3). */
  setSends(): void {
    if (this.closed || this.sends) return;
    this.sends = true;
    if (!this.transceiver) this.addTransceiver();
    else this.transceiver.direction = "sendrecv";
    this.replaceTrack();
  }

  /** Mic on (the track) or off (null): no renegotiation, no messages. */
  setTrack(track: MediaStreamTrack | null): void {
    this.track = track;
    this.replaceTrack();
  }

  async stats(): Promise<PeerStats> {
    const report = await this.pc.getStats();
    let pair: RTCIceCandidatePairStats | undefined;
    let jitter: number | null = null;
    let packetsLost = 0;
    report.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId);
      if (r.type === "inbound-rtp" && r.kind === "audio") {
        jitter = Math.max(jitter ?? 0, r.jitter ?? 0);
        packetsLost += r.packetsLost ?? 0;
      }
    });
    const rtt = pair?.currentRoundTripTime;
    return {
      state: this.pc.connectionState,
      rttMs: rtt === undefined ? null : Math.round(rtt * 1000),
      jitterMs: jitter === null ? null : Math.round(jitter * 1000),
      packetsLost,
      relayed: pair ? report.get(pair.localCandidateId)?.candidateType === "relay" : false,
    };
  }

  get health(): PeerHealth {
    return peerHealth(this.recovery);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.setTimer(null);
    if (this.resendTimer) clearTimeout(this.resendTimer);
    this.pc.close();
  }

  private addTransceiver(): void {
    this.transceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.replaceTrack();
  }

  private replaceTrack(): void {
    const sender = this.transceiver?.sender;
    if (sender && this.sends && sender.track !== this.track) void sender.replaceTrack(this.track).catch(() => {});
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(() => (this.closed ? undefined : task())).catch(() => {});
  }

  private async offer(): Promise<void> {
    this.makingOffer = true;
    try {
      await this.pc.setLocalDescription();
      await this.gathered();
      // Rolled back meanwhile (glare, polite side): the remote offer won.
      if (this.closed || this.pc.signalingState !== "have-local-offer") return;
      this.sendLocal();
      this.scheduleResend();
    } finally {
      this.makingOffer = false;
    }
  }

  private async receive(signal: Signal): Promise<void> {
    const description = signal.sdp;
    if (description.type === "answer") {
      // A duplicate or stale answer; only one we're waiting for applies.
      if (this.pc.signalingState !== "have-local-offer") return;
      try {
        await this.pc.setRemoteDescription(description);
      } catch {
        this.fail();
      }
      return;
    }

    // The same offer again (resent while ours was on its way): same answer.
    if (description.sdp === this.lastRemoteOffer && this.lastAnswer && this.pc.signalingState === "stable") {
      this.options.signalling.send(this.remote, "description", this.lastAnswer as Signal["sdp"]);
      return;
    }
    const collision = this.makingOffer || this.pc.signalingState !== "stable";
    if (collision && !this.polite) return;
    try {
      await this.pc.setRemoteDescription(description); // the polite side rolls back implicitly
    } catch {
      // Not ours to apply (the remote rebuilt its side): a fresh peer takes it.
      this.detach();
      this.options.signalling.hold(signal);
      this.fail();
      return;
    }
    this.adoptTransceiver();
    await this.pc.setLocalDescription();
    await this.gathered();
    if (this.closed || !this.pc.localDescription || this.pc.localDescription.type !== "answer") return;
    this.lastRemoteOffer = description.sdp;
    this.lastAnswer = this.sendLocal();
  }

  /** After applying an offer: send on the first negotiated transceiver. One
   * we added that lost the glare is left inactive; it costs one more round
   * once. (Stopping it instead makes Chrome ask to negotiate forever.) */
  private adoptTransceiver(): void {
    const negotiated = this.pc.getTransceivers().find((t) => t.mid !== null && t.currentDirection !== "stopped");
    if (!negotiated) return;
    if (this.transceiver && this.transceiver !== negotiated) this.transceiver.direction = "inactive";
    this.transceiver = negotiated;
    negotiated.direction = this.sends ? "sendrecv" : "recvonly";
    this.replaceTrack();
  }

  private sendLocal(): RTCSessionDescriptionInit {
    const { type, sdp } = this.pc.localDescription!;
    const description = { type, sdp } as Signal["sdp"];
    this.options.signalling.send(this.remote, this.restarting ? "restart" : "description", description);
    this.restarting = false;
    return description;
  }

  private scheduleResend(): void {
    if (this.resendTimer) clearTimeout(this.resendTimer);
    const sent = this.pc.localDescription?.sdp;
    this.resendTimer = setTimeout(() => {
      this.resendTimer = null;
      if (this.closed || this.pc.signalingState !== "have-local-offer" || this.pc.localDescription?.sdp !== sent) return;
      this.options.signalling.send(this.remote, "description", this.pc.localDescription!.toJSON() as Signal["sdp"]);
      this.scheduleResend();
    }, RESEND_OFFER_MS);
  }

  private gathered(): Promise<void> {
    if (this.pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(cap);
        this.pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => this.pc.iceGatheringState === "complete" && done();
      const cap = setTimeout(done, GATHER_CAP_MS);
      this.pc.addEventListener("icegatheringstatechange", check);
    });
  }

  private async capBitrate(): Promise<void> {
    const sender = this.transceiver?.sender;
    if (!sender || this.closed) return;
    const params = sender.getParameters();
    const encoding = params.encodings?.[0];
    if (!encoding || encoding.maxBitrate === MAX_BITRATE) return;
    encoding.maxBitrate = MAX_BITRATE;
    await sender.setParameters(params).catch(() => {});
  }

  private step(input: RecoveryInput): void {
    if (this.closed) return;
    const before = this.health;
    const step = nextRecovery(this.recovery, input, this.polite);
    this.recovery = step.recovery;
    if (step.timeoutMs !== undefined) this.setTimer(step.timeoutMs);
    if (step.restartIce) {
      this.iceRestarts++;
      this.restarting = true;
      this.pc.restartIce();
    }
    if (step.close) return this.fail();
    if (this.health !== before) this.options.onHealth(this.health);
  }

  private setTimer(ms: number | null): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = ms === null ? null : setTimeout(() => this.step({ kind: "timeout" }), ms);
  }

  private fail(): void {
    if (this.closed) return;
    this.close();
    this.options.onClosed();
  }
}
