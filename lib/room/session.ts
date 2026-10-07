import { ApiError } from "@/lib/api/client";
import type { AnnotationRange } from "@/lib/api/types";
import * as api from "@/lib/room/api";
import { openRoomChannel, type ChannelStatus, type RoomChannel } from "@/lib/room/channel";
import { CHAT_EMPTY, createChat, type Chat, type ChatSnapshot, type SharedPassage } from "@/lib/room/chat";
import { confirmEnded, type RoomPresence, type RoomReaction } from "@/lib/room/events";
import { createFollow, FOLLOW_IDLE, type Follow, type FollowSnapshot } from "@/lib/room/follow";
import { createMesh, type Mesh } from "@/lib/room/mesh";
import { createMic, type Mic, type MicState } from "@/lib/room/mic";
import { Peer, type PeerHealth, type PeerOptions, type PeerStats } from "@/lib/room/peer";
import { createPlayback, type Playback } from "@/lib/room/playback";
import { isSuperseded, selectRoster, selectSpeaking } from "@/lib/room/presence";
import { createReactions, type Reactions, type RisingReaction } from "@/lib/room/reactions";
import { createSignalling, type Signalling } from "@/lib/room/signalling";
import { startSpeakingDetector } from "@/lib/room/speaking";
import type { RoomInfo, RoomJoinPayload, RoomLeaveStats } from "@/lib/room/types";
import type { ReaderView } from "@/lib/room/view";
import { comradeName } from "@/lib/reader/authorDisplay";

// RoomSession: the room's one orchestrator (spec §8.1). Framework-free: it
// pushes immutable snapshots to subscribers (stores/room-store.ts) and no
// component touches the channel, a peer or the AudioContext. Presence drives
// the mesh (who connects to whom); the mic feeds every peer; playback plays
// and measures what arrives; speaking detection reads those levels.

const HEARTBEAT_MS = 30_000;
/** events.ts caps `highlight` at 50 ranges (blocks). */
const MAX_HIGHLIGHT_RANGES = 50;
/** Dev: `localStorage["ominira-room-relay"] = "1"` sends all audio through TURN (spec §8.4). */
const FORCE_RELAY_KEY = "ominira-room-relay";

export type RoomSnapshot = {
  room: RoomInfo;
  isModerator: boolean;
  moderatorIds: string[];
  readerId: string;
  sessionId: string;
  /** One entry per reader, in join order (presence.ts). */
  roster: RoomPresence[];
  micOn: boolean;
  micState: MicState;
  handRaised: boolean;
  /** readerIds whose voice is detected now (speaking.ts), you included. */
  speakingIds: string[];
  /** Audio link per remote readerId, while one is wanted (spec §10: speaker dropped). */
  peerHealth: Record<string, PeerHealth>;
  /** Playback is held up: "Tap to resume audio" (spec §8.6). */
  audioSuspended: boolean;
  connection: ChannelStatus;
  ended: { endedAt: string } | null;
  /** This tab yielded to a newer one of the same reader (spec §8.2). */
  elsewhere: boolean;
  /** Who you follow, where the readers sending `pos` are, a pending summon (follow.ts). */
  follow: FollowSnapshot;
  /** The speakers' selections by readerId, for the speaker band (spec §3.1). */
  highlights: Record<string, SpeakerHighlight>;
  /** Room chat since you joined, and what's unread (chat.ts). */
  chat: ChatSnapshot;
  /** Reactions rising now, yours included (reactions.ts). */
  rising: RisingReaction[];
};

export type SpeakerHighlight = { ranges: AnnotationRange[]; at: number };

/** What the session uses of a Peer. */
type PeerLike = Pick<Peer, "setSends" | "setTrack" | "close" | "stats" | "iceRestarts">;

/** What a session is built from: the real modules, or fakes in the Node
 * integration test (session.test.ts, spec §8.10). */
export type SessionDeps = {
  api: Pick<typeof api, "startRoom" | "joinRoom" | "leaveRoom" | "leaveRoomOnUnload" | "endRoom">;
  openRoomChannel: typeof openRoomChannel;
  createPeer: (options: PeerOptions) => PeerLike;
  createMic: typeof createMic;
  createPlayback: typeof createPlayback;
};

const REAL_DEPS: SessionDeps = {
  api,
  openRoomChannel,
  createPeer: (options) => new Peer(options),
  createMic,
  createPlayback,
};

/** A mesh entry: the peer and its playback, closed together. */
type MeshEntry = { peer: PeerLike; close(): void };

/** Everything that lives for one visit to one room. */
type Engine = {
  roomId: string;
  channel: RoomChannel;
  signalling: Signalling;
  mesh: Mesh<MeshEntry>;
  mic: Mic;
  playback: Playback;
  /** The mic track while on, handed to new peers. */
  track: MediaStreamTrack | null;
  roster: RoomPresence[];
  follow: Follow;
  chat: Chat;
  reactions: Reactions;
  /** The last `highlight` sent, so an unchanged one isn't sent again. */
  highlightKey: string;
  /** For the leave beacon. */
  stats: RoomLeaveStats;
};

export class RoomSession {
  private engine: Engine | null = null;
  private abort = new AbortController();
  private listeners = new Set<(snapshot: RoomSnapshot | null) => void>();
  private snapshot: RoomSnapshot | null = null;
  private presence: RoomPresence | null = null;
  /** The open reader and its selection (useRoomView), kept across visits. */
  private view: ReaderView | null = null;
  private selection: readonly AnnotationRange[] | null = null;
  /** The room chat is on screen (RoomChat), kept across visits. */
  private chatViewing = false;

  constructor(
    private readonly readerId: string,
    private readonly accessToken: () => Promise<string | null>,
    /** Created and resumed in the join tap (room-store), so sound is allowed. */
    private readonly audio: AudioContext,
    private readonly deps: SessionDeps = REAL_DEPS,
  ) {}

  /** Starts a room on the book, or joins the one already live on it. */
  async start(materialId: string, title?: string): Promise<void> {
    this.enter(await this.deps.api.startRoom(materialId, title));
  }

  async join(roomId: string): Promise<void> {
    this.enter(await this.deps.api.joinRoom(roomId));
  }

  async leave(): Promise<void> {
    const roomId = this.snapshot?.room.id;
    // A yielded tab leaves quietly: the reader is still in through the other tab.
    const wasLive = this.snapshot && !this.snapshot.ended && !this.snapshot.elsewhere;
    const stats = this.leaveStats();
    this.publish(null);
    // Free the place now; closing the channel waits on the server.
    const leaving = roomId && wasLive ? this.deps.api.leaveRoom(roomId, stats).catch(() => {}) : null;
    await Promise.all([this.teardown(), leaving]);
  }

  /** Moderators. The server's `ended` follows, but the room is over either way. */
  async end(): Promise<void> {
    if (!this.snapshot || this.snapshot.ended || this.snapshot.elsewhere) return;
    await this.deps.api.endRoom(this.snapshot.room.id);
    await this.finish(new Date().toISOString());
  }

  /** On: ask for the mic, start sending, then say so in presence (and lower
   * a raised hand, spec §1.1). A blocked mic changes nothing for others. */
  async setMic(on: boolean): Promise<void> {
    const engine = this.engine;
    if (!engine || !this.presence) return;
    if (!on) {
      engine.mic.off();
      if (this.presence.micOnAt !== null) this.updatePresence({ micOnAt: null });
      this.textChanged();
      return;
    }
    await engine.mic.on();
    if (engine !== this.engine || engine.mic.state !== "on" || !this.presence) return;
    if (!this.presence.sends) {
      // The first mic-on: listeners now want a peer with us (spec §8.3).
      this.presence = { ...this.presence, sends: true };
      for (const { peer } of engine.mesh.peers.values()) peer.setSends();
      this.reconcile();
    }
    if (this.presence.micOnAt === null) this.updatePresence({ micOnAt: Date.now(), handRaisedAt: null });
    this.textChanged();
  }

  raiseHand(): void {
    if (this.presence?.handRaisedAt === null) this.updatePresence({ handRaisedAt: Date.now() });
  }

  lowerHand(): void {
    if (this.presence?.handRaisedAt !== null) this.updatePresence({ handRaisedAt: null });
  }

  // ── Presence in the text (spec §9): the open reader, and following ──

  /** The open reader, or null (useRoomView through the room store). */
  setView(view: ReaderView | null): void {
    this.view = view;
    this.engine?.follow.setView(view);
    this.sendHighlight();
  }

  /** Your selection in the open reader; sent while your mic is on (spec §3.1). */
  setSelection(ranges: readonly AnnotationRange[] | null): void {
    this.selection = ranges;
    this.sendHighlight();
  }

  follow(readerId: string): void {
    this.engine?.follow.follow(readerId);
  }

  unfollow(): void {
    this.engine?.follow.unfollow();
  }

  returnToFollowed(): void {
    this.engine?.follow.returnToFollowed();
  }

  /** Moderators (spec §12). False when you're not in the book's reader. */
  summonEveryone(): boolean {
    return this.engine?.follow.summonEveryone() ?? false;
  }

  jumpToSummon(): void {
    this.engine?.follow.jumpToSummon();
  }

  dismissSummon(): void {
    this.engine?.follow.dismissSummon();
  }

  // ── Chat (spec §1.4) ──

  /** False when it's blank or within 2 s of your last message. */
  sendChat(text: string, passage?: SharedPassage): boolean {
    return this.engine?.chat.send(text, passage) ?? false;
  }

  /** Whether a message would be sent now (Share passage checks before saving its note). */
  chatReady(): boolean {
    return this.engine?.chat.ready() ?? false;
  }

  setChatViewing(viewing: boolean): void {
    this.chatViewing = viewing;
    this.engine?.chat.setViewing(viewing);
  }

  react(emoji: RoomReaction): void {
    this.engine?.reactions.react(emoji);
  }

  /** In a tap: "Tap to resume audio". */
  async resumeAudio(): Promise<void> {
    await this.engine?.playback.resume();
  }

  /** The dev overlay (spec §8.10): asks each peer's getStats once. */
  async peerStats(): Promise<(PeerStats & { readerId: string; name: string })[]> {
    const engine = this.engine;
    if (!engine) return [];
    const bySession = new Map(engine.roster.map((p) => [p.sessionId, p]));
    return Promise.all(
      [...engine.mesh.peers].map(async ([sessionId, { peer }]) => ({
        readerId: bySession.get(sessionId)?.readerId ?? sessionId,
        name: bySession.get(sessionId)?.name ?? "?",
        ...(await peer.stats()),
      })),
    );
  }

  /** Called at once with the current snapshot; returns the unsubscribe. */
  subscribe(listener: (snapshot: RoomSnapshot | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private enter(join: RoomJoinPayload): void {
    const { signal } = this.abort;
    const roomId = join.room.id;
    const sessionId = crypto.randomUUID();
    const forceRelay = readFlag(FORCE_RELAY_KEY);
    this.presence = {
      readerId: this.readerId,
      sessionId,
      joinedAt: Date.now(),
      name: join.me.name,
      avatar: join.me.avatar,
      isModerator: join.isModerator,
      sends: false,
      micOnAt: null,
      handRaisedAt: null,
      followingId: null,
      // follow.ts sets these once the book's reader is open.
      progressPct: 0,
      mode: "read",
      inReader: false,
    };
    this.publish({
      room: join.room,
      isModerator: join.isModerator,
      moderatorIds: join.moderatorIds,
      readerId: this.readerId,
      sessionId,
      roster: [],
      micOn: false,
      micState: "off",
      handRaised: false,
      speakingIds: [],
      peerHealth: {},
      audioSuspended: false,
      connection: "connecting",
      ended: null,
      elsewhere: false,
      follow: FOLLOW_IDLE,
      highlights: {},
      chat: CHAT_EMPTY,
      rising: [],
    });

    const channel = this.deps.openRoomChannel({
      join,
      readerId: this.readerId,
      accessToken: this.accessToken,
      onRoster: (entries) => {
        if (this.presence && isSuperseded(this.presence, entries)) return void this.yieldToNewerTab();
        const roster = selectRoster(entries);
        engine.roster = roster;
        engine.stats.peakMics = Math.max(engine.stats.peakMics, roster.filter((p) => p.micOnAt !== null).length);
        engine.signalling.setRoster(roster);
        this.reconcile();
        engine.follow.setRoster(roster);
        engine.chat.setRoster(roster);
        this.patch({ roster, highlights: keepMembers(this.snapshot?.highlights ?? {}, roster) });
      },
      onStatus: (connection) => {
        // Back after a drop: one reconcile; peers already up were never touched (spec §8.8).
        if (connection === "live" && this.snapshot?.connection === "reconnecting") this.reconcile();
        this.patch({ connection });
      },
    });

    const playback = this.deps.createPlayback({
      context: this.audio,
      onSuspended: (audioSuspended) => this.patch({ audioSuspended }),
    });
    const signalling = createSignalling({ channel, sessionId });

    const mesh = createMesh<MeshEntry>({
      create: (remote) => {
        const setHealth = (health: PeerHealth | null) => {
          const peerHealth = { ...this.snapshot?.peerHealth };
          if (health) peerHealth[remote.readerId] = health;
          else delete peerHealth[remote.readerId];
          this.patch({ peerHealth });
          if (health !== "connected") return;
          const connected = Object.values(peerHealth).filter((h) => h === "connected").length;
          engine.stats.peakPeers = Math.max(engine.stats.peakPeers, connected);
          if (!engine.stats.usedTurn) void entry.peer.stats().then((s) => (engine.stats.usedTurn ||= s.relayed));
        };
        const entry: MeshEntry = {
          peer: this.deps.createPeer({
            sessionId,
            remote: remote.sessionId,
            remoteSends: remote.sends,
            sends: this.presence?.sends ?? false,
            track: engine.track,
            iceServers: join.iceServers,
            forceRelay,
            signalling,
            onStream: (stream) => playback.add(remote.sessionId, stream),
            onHealth: setHealth,
            // Failed for good: the next pass builds a fresh one if still wanted.
            onClosed: () => {
              engine.stats.iceRestarts += entry.peer.iceRestarts;
              playback.remove(remote.sessionId);
              mesh.forget(remote.sessionId, entry);
            },
          }),
          close: () => {
            engine.stats.iceRestarts += entry.peer.iceRestarts;
            entry.peer.close();
            playback.remove(remote.sessionId);
            setHealth(null);
          },
        };
        return entry;
      },
    });

    const mic = this.deps.createMic({
      onChange: (micState, track) => {
        engine.track = track;
        for (const { peer } of mesh.peers.values()) peer.setTrack(track);
        playback.setLocal(sessionId, track);
        this.patch({ micState });
      },
    });

    const follow = createFollow({
      readerId: this.readerId,
      roomMaterialId: join.room.materialId,
      moderatorIds: join.moderatorIds,
      channel,
      presence: () => this.presence,
      updatePresence: (change) => this.updatePresence(change),
      onChange: (follow) => this.patch({ follow }),
      signal,
    });

    const chat = createChat({ readerId: this.readerId, channel, onChange: (chat) => this.patch({ chat }) });
    chat.setViewing(this.chatViewing);

    const reactions = createReactions({
      readerId: this.readerId,
      channel,
      // Whose point it is: who's heard now, else the newest live mic.
      speakerId: () => {
        const mics = selectSpeaking(engine.roster);
        return (mics.find((p) => this.snapshot?.speakingIds.includes(p.readerId)) ?? mics[0])?.readerId ?? null;
      },
      nameOf: (id) => comradeName(this.snapshot?.chat.people[id]?.name ?? "comrade"),
      onRising: (rising) => this.patch({ rising }),
      onDigest: ({ text, emojis }) => chat.add({ kind: "digest", id: "", at: Date.now(), text, emojis }),
      signal,
    });

    const engine: Engine = {
      roomId,
      channel,
      signalling,
      mesh,
      mic,
      playback,
      track: null,
      roster: [],
      follow,
      chat,
      reactions,
      highlightKey: "null",
      stats: { peakMics: 0, peakPeers: 0, iceRestarts: 0, usedTurn: false },
    };
    this.engine = engine;
    channel.track(this.presence);
    follow.setView(this.view);

    channel.on("highlight", ({ from, ranges }) => {
      if (from === this.readerId) return;
      const highlights = { ...this.snapshot?.highlights };
      if (ranges?.length) highlights[from] = { ranges, at: Date.now() };
      else delete highlights[from];
      this.patch({ highlights });
    });

    channel.on("ended", async (event) => {
      if (await confirmEnded(() => channel.readStatus())) await this.finish(event.endedAt);
    });

    startSpeakingDetector({
      levels: () => playback.levels(),
      onChange: (sessionIds) => {
        const bySession = new Map(engine.roster.map((p) => [p.sessionId, p.readerId]));
        bySession.set(sessionId, this.readerId);
        this.patch({ speakingIds: sessionIds.flatMap((id) => bySession.get(id) ?? []) });
      },
      signal,
    });

    // Sign of life for the empty-room sweep; false means we aged out
    // (asleep, offline), so join again unless the room has ended.
    const beat = setInterval(async () => {
      if (await channel.heartbeat()) return;
      try {
        await this.deps.api.joinRoom(roomId);
      } catch (err) {
        if (err instanceof ApiError && err.code === "room_ended") await this.finish(new Date().toISOString());
      }
    }, HEARTBEAT_MS);
    signal.addEventListener("abort", () => clearInterval(beat));

    // Back from a hidden tab or a locked phone: audio first, then any peer
    // that broke meanwhile (spec §8.8).
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState !== "visible") return;
        void playback.resume();
        this.reconcile();
      },
      { signal },
    );
    // Rejoined after a reload there was no tap to allow sound in, so the
    // first one anywhere resumes it ("Tap to resume audio" says so meanwhile).
    const unlock = () => {
      if (playback.suspended) void playback.resume();
    };
    for (const type of ["pointerdown", "keydown"]) {
      window.addEventListener(type, unlock, { capture: true, passive: true, signal });
    }
    window.addEventListener("pagehide", () => this.deps.api.leaveRoomOnUnload(roomId, this.leaveStats()!), {
      signal,
    });
  }

  /** Restarts by peers still open are added to those of closed ones. */
  private leaveStats(): RoomLeaveStats | undefined {
    const engine = this.engine;
    if (!engine) return undefined;
    let open = 0;
    for (const { peer } of engine.mesh.peers.values()) open += peer.iceRestarts;
    return { ...engine.stats, iceRestarts: engine.stats.iceRestarts + open };
  }

  private reconcile(): void {
    const engine = this.engine;
    if (engine && this.presence) engine.mesh.update(this.presence, engine.roster);
  }

  /** The room is over: stop everything, keep the snapshot for the ended screen. */
  private async finish(endedAt: string): Promise<void> {
    if (!this.snapshot || this.snapshot.ended) return;
    this.patch({ ended: { endedAt } });
    await this.teardown();
  }

  /** Another tab of this reader joined later: stop here without leaving
   * (the reader is still in the room there), and say so. */
  private async yieldToNewerTab(): Promise<void> {
    if (!this.snapshot || this.snapshot.ended || this.snapshot.elsewhere) return;
    this.patch({
      elsewhere: true,
      roster: [],
      micOn: false,
      micState: "off",
      handRaised: false,
      speakingIds: [],
      follow: FOLLOW_IDLE,
      highlights: {},
      rising: [],
    });
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.abort.abort();
    this.abort = new AbortController();
    this.presence = null;
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    engine.mesh.close();
    engine.signalling.close();
    engine.mic.close();
    engine.playback.close();
    await engine.channel.close();
  }

  /** Mic on or off: your place may now be wanted, your selection shown or cleared. */
  private textChanged(): void {
    this.engine?.follow.moved();
    this.sendHighlight();
  }

  /** Your selection while your mic is on in the book's reader, else nothing;
   * sent on change only. Positions only: receivers have the text. */
  private sendHighlight(): void {
    const engine = this.engine;
    if (!engine || !this.presence) return;
    const shown =
      this.presence.micOnAt !== null && this.view?.materialId === this.snapshot?.room.materialId && this.selection?.length
        ? this.selection.slice(0, MAX_HIGHLIGHT_RANGES).map(({ passageId, start, end }) => ({ passageId, start, end }))
        : null;
    const key = JSON.stringify(shown);
    if (key === engine.highlightKey) return;
    engine.highlightKey = key;
    engine.channel.send("highlight", { from: this.readerId, ranges: shown });
  }

  private updatePresence(change: Partial<RoomPresence>): void {
    if (!this.presence || !this.engine) return;
    this.presence = { ...this.presence, ...change };
    this.engine.channel.track(this.presence);
    this.patch({ micOn: this.presence.micOnAt !== null, handRaised: this.presence.handRaisedAt !== null });
  }

  private patch(change: Partial<RoomSnapshot>): void {
    if (this.snapshot) this.publish({ ...this.snapshot, ...change });
  }

  private publish(snapshot: RoomSnapshot | null): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Drops entries of readers who have left. */
function keepMembers<T>(byReader: Record<string, T>, roster: readonly RoomPresence[]): Record<string, T> {
  const ids = new Set(roster.map((p) => p.readerId));
  const kept = Object.entries(byReader).filter(([id]) => ids.has(id));
  return kept.length === Object.keys(byReader).length ? byReader : Object.fromEntries(kept);
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
