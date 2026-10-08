"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "lucide-react";
import { useAudioStore } from "@/stores/audio-store";
import Tooltip from "./reader/Tooltip";
import { formatDuration } from "@/utils/text";
import { AFRICAN_VOICES } from "@/lib/audio/voices";
import VoiceChangeModal from "./VoiceChangeModal";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

type Props = {
  variant?: "full" | "mini";
  bookTitle: string;
  chapterLabel: string;
  coverSrc?: string;
  /** A real, exact duration — nothing sets this today (every book streams
   * live narration; see NarrationEngine's own doc comment), but the prop
   * stays here as where a future prerecorded, fixed-duration section would
   * plug back in its real mm:ss scrubbable timeline. Omit (or pass 0) for
   * the streaming case, which renders no timeline at all — there's no
   * fixed duration to show for audio still being synthesized on demand,
   * and an estimated one would be false precision that corrects itself
   * under the reader mid-scrub. Seeking starts from a paragraph control
   * in the text itself (karaoke-style), not by dragging a bar here. */
  durationMs?: number;
  /** True while the passage the player is targeting isn't playable yet
   * (still synthesizing) — shows a spinner over the play button instead of
   * the play/pause icon, the same "buffering" affordance any podcast app
   * gives a track that hasn't loaded. */
  isBuffering?: boolean;
  /** Routes through the caller instead of the store's seekTo directly — for
   * TTS-driven playback there's no real audio timeline to scrub, so Reader
   * resyncs the speech engine to the nearest passage on seek. This is the
   * one thing that must vary by audio source, and it lives in the caller so
   * this component never has to branch on where the audio is coming from. */
  onSeek: (ms: number) => void;
  /** Jump narration to the adjacent spine section (from its first word),
   * independent of whatever's currently on screen — distinct from the ±15s
   * seek buttons. No-op when that neighbor has no track, which is what
   * canSkipPrev/canSkipNext disable for. */
  onSkipPrev: () => void;
  onSkipNext: () => void;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  /** Exits listen mode entirely (distinct from pause) — resume position is
   * left untouched in library-store, so reopening the player later picks
   * up where playback left off instead of restarting. */
  onClose?: () => void;
  /** Cover/title doubles as the "now playing" affordance — jumps to the
   * book's reader page. Optional since not every embedding wants this
   * (e.g. an admin preview). */
  onTitleClick?: () => void;
};

function SpeedMenu({
  speed,
  isMobile,
  onSelect,
  onClose,
}: {
  speed: number;
  isMobile: boolean;
  onSelect: (s: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-19" />
      {isMobile ? (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1 rounded-sm bg-[var(--reader-surface)] border border-[var(--reader-border)] shadow-lg z-20 whitespace-nowrap">
          {SPEEDS.map((s) => {
            const active = s === speed;
            return (
              <button
                key={s}
                onClick={() => onSelect(s)}
                className={`border-none cursor-pointer rounded-sm py-1.5 px-2.5 text-[11px] font-semibold ${
                  active ? "bg-brand-500 text-white" : "bg-transparent text-[var(--reader-text-muted)]"
                }`}
              >
                {s}×
              </button>
            );
          })}
        </div>
      ) : (
        <div className="absolute bottom-[calc(100%+14px)] left-1/2 -translate-x-1/2 min-w-34 p-2.5 rounded-lg bg-[var(--reader-surface)] border border-[var(--reader-border)] shadow-lg z-20">
          <div className="text-[10px] font-bold tracking-wide uppercase text-[var(--reader-text-muted)] px-2.5 pt-0.5 pb-2">
            Playback Speed
          </div>
          <div className="flex flex-col gap-0.5">
            {SPEEDS.map((s) => {
              const active = s === speed;
              return (
                <button
                  key={s}
                  onClick={() => onSelect(s)}
                  className={`flex items-center justify-between border-none cursor-pointer rounded-sm py-2 px-3.5 text-[13px] font-medium ${
                    active ? "bg-brand-500/10 text-brand-500 font-semibold" : "bg-transparent text-[var(--reader-text)]"
                  }`}
                >
                  {s}×
                  {active && <Check size={13} className="flex-none" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export default function AudioPlayer({
  variant = "full",
  bookTitle,
  chapterLabel,
  coverSrc,
  durationMs = 0,
  isBuffering = false,
  onSeek,
  onSkipPrev,
  onSkipNext,
  canSkipPrev,
  canSkipNext,
  onClose,
  onTitleClick,
}: Props) {
  const isMini = variant === "mini";
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const currentTimeMs = useAudioStore((s) => s.currentTimeMs);
  const speed = useAudioStore((s) => s.speed);
  const toggle = useAudioStore((s) => s.toggle);
  const setSpeed = useAudioStore((s) => s.setSpeed);
  // Reader-wide preference, same footing as speed — read/written straight
  // from audio-store here rather than threaded through as a prop, exactly
  // how speed already works.
  const voice = useAudioStore((s) => s.voice);
  const setVoice = useAudioStore((s) => s.setVoice);

  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 720);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const duration = durationMs / 1000;
  const time = Math.min(currentTimeMs / 1000, duration);
  const progress = duration > 0 ? time / duration : 0;
  const withHours = duration >= 3600;
  const showsDuration = duration > 0;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(Math.round(pct * duration * 1000));
  };

  const coverSize = isMini ? "w-8 h-8" : isMobile ? "w-9 h-9" : "w-9.5 h-9.5";
  const playSize = isMini ? "w-8.5 h-8.5" : "w-11 h-11";

  const speedTrigger = (
    <Tooltip label="Playback speed" side="top">
      <button
        onClick={() => setSpeedMenuOpen((o) => !o)}
        className="flex items-center gap-0.5 border-none cursor-pointer rounded-sm py-1.25 px-2.5 text-xs font-semibold bg-[var(--reader-surface-hover)] text-[var(--reader-text-muted)] flex-none"
      >
        {speed}×
        <ChevronDown size={12} />
      </button>
    </Tooltip>
  );

  const activeVoice = AFRICAN_VOICES.find((v) => v.id === voice) ?? AFRICAN_VOICES[0];

  // Narrator identity strip — avatar, given name, and voice traits, doubling
  // as the "change voice" trigger (opens VoiceChangeModal). Shown in both
  // the desktop and mobile full-player layouts (not the mini bar, which has
  // no room for more than an icon).
  const narratorStrip = (
    <Tooltip label="Narrator voice" side="top">
      <button
        onClick={() => setVoiceMenuOpen(true)}
        className="flex items-center gap-2 min-w-0 border-none bg-transparent p-0 cursor-pointer"
      >
        <img src={activeVoice.avatar} alt={activeVoice.name} className="h-11 w-11 flex-none rounded-full object-cover" />
        <div className="min-w-0 leading-tight text-left">
          <div className="text-xs font-semibold text-[var(--reader-text)] whitespace-nowrap overflow-hidden text-ellipsis">
            {activeVoice.name}
          </div>
          <div className="text-[10.5px] font-medium text-[var(--reader-text-muted)] whitespace-nowrap overflow-hidden text-ellipsis">
            Narrating · {activeVoice.traits}
          </div>
        </div>
        <ChevronDown size={12} className="flex-none text-[var(--reader-text-muted)]" />
      </button>
    </Tooltip>
  );

  const skipPrevBtn = (
    <Tooltip label="Previous" side="top" align="start">
      <button
        onClick={onSkipPrev}
        disabled={!canSkipPrev}
        aria-label="Previous chapter"
        className="bg-transparent border-none cursor-pointer text-[var(--reader-text)] w-8 h-8 flex items-center justify-center disabled:opacity-25 disabled:cursor-default"
      >
        <SkipBack size={17} />
      </button>
    </Tooltip>
  );
  const back15Btn = (
    <Tooltip label="Back 15 seconds" side="top">
      <button
        onClick={() => onSeek(currentTimeMs - 15_000)}
        aria-label="Back 15 seconds"
        className="relative bg-transparent border-none cursor-pointer text-[var(--reader-text)] w-8 h-8 flex items-center justify-center"
      >
        <RotateCcw size={19} />
        <span className="absolute text-[7px] font-bold">15</span>
      </button>
    </Tooltip>
  );
  // Buffering still toggles play intent on click (isBuffering just means
  // "not playable yet", not "the button doesn't work") — it starts playing
  // itself the moment the targeted passage finishes synthesizing, same as
  // any podcast app's spinner-on-a-still-loading-episode.
  const playBtn = (
    <button
      onClick={toggle}
      aria-label={isPlaying ? "Pause" : "Play"}
      className={`${playSize} rounded-full bg-brand-500 border-none cursor-pointer flex items-center justify-center flex-none text-sand-25 shadow-sm`}
    >
      {isBuffering ? (
        <Loader2 size={isMini ? 15 : 19} className="animate-spin" />
      ) : isPlaying ? (
        <Pause size={isMini ? 15 : 19} />
      ) : (
        <Play size={isMini ? 15 : 19} />
      )}
    </button>
  );
  const forward15Btn = (
    <Tooltip label="Forward 15 seconds" side="top">
      <button
        onClick={() => onSeek(currentTimeMs + 15_000)}
        aria-label="Forward 15 seconds"
        className="relative bg-transparent border-none cursor-pointer text-[var(--reader-text)] w-8 h-8 flex items-center justify-center"
      >
        <RotateCw size={19} />
        <span className="absolute text-[7px] font-bold">15</span>
      </button>
    </Tooltip>
  );
  const skipNextBtn = (
    <Tooltip label="Next" side="top">
      <button
        onClick={onSkipNext}
        disabled={!canSkipNext}
        aria-label="Next chapter"
        className="bg-transparent border-none cursor-pointer text-[var(--reader-text)] w-8 h-8 flex items-center justify-center disabled:opacity-25 disabled:cursor-default"
      >
        <SkipForward size={17} />
      </button>
    </Tooltip>
  );
  const closeBtn = onClose && (
    <Tooltip label="Close player" side="top" align="end">
      <button
        onClick={onClose}
        aria-label="Close player"
        className="w-8 h-8 rounded-sm flex-none flex items-center justify-center border-none cursor-pointer bg-transparent text-[var(--reader-text-muted)] hover:bg-[var(--reader-surface-hover)]"
      >
        <X size={16} />
      </button>
    </Tooltip>
  );

  const coverAndMeta = (
    <button
      onClick={onTitleClick}
      disabled={!onTitleClick}
      title={onTitleClick ? "Back to book" : undefined}
      className="flex items-center gap-2.5 min-w-0 flex-1 border-none bg-transparent p-0 text-left disabled:cursor-default"
      style={{ cursor: onTitleClick ? "pointer" : "default" }}
    >
      {coverSrc ? <img src={coverSrc} alt="cover" className={`${coverSize} object-cover rounded-xs flex-none`} /> : null}
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--reader-text)] whitespace-nowrap overflow-hidden text-ellipsis">
          {bookTitle}
        </div>
        <div className="text-xs font-medium text-[var(--reader-text-muted)] whitespace-nowrap overflow-hidden text-ellipsis">
          {chapterLabel}
        </div>
      </div>
    </button>
  );

  return (
    <div
      className="w-full h-full box-border relative flex flex-col justify-center bg-[var(--reader-surface)] border-t border-b border-[var(--reader-border)] pb-[env(safe-area-inset-bottom)]"
    >
      {/* Progress track — only ever rendered for a real, exact duration
          (a future prerecorded, fixed-duration section; see durationMs's
          own doc comment). The current streaming case has no fixed
          duration to show a timeline for, so it shows none at all rather
          than a fake one — seeking starts from paragraph controls in the
          reader itself instead. */}
      {showsDuration && (
        <div className={`flex items-center gap-2.5 ${isMini ? "px-4 pt-2" : isMobile ? "px-3.5 pt-2.5" : "px-6 pt-3"}`}>
          <span className="text-[11px] font-medium text-[var(--reader-text-muted)] flex-none tabular-nums">
            {formatDuration(time, withHours)}
          </span>
          <div onClick={onScrub} className="flex-1 h-4 flex items-center cursor-pointer">
            <div className="w-full h-1 rounded-sm bg-[var(--reader-border)] overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-sm"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] font-medium text-[var(--reader-text-muted)] flex-none tabular-nums">
            -{formatDuration(duration - time, withHours)}
          </span>
        </div>
      )}

      {isMobile ? (
        <>
          <div className="flex items-center gap-2.5 px-3.5 pt-4 pb-3">
            {coverAndMeta}
            {closeBtn}
          </div>
          <div className="flex items-center justify-center gap-5 px-3.5 pb-3.5">
            {skipPrevBtn}
            {back15Btn}
            {playBtn}
            {forward15Btn}
            {skipNextBtn}
          </div>
          <div className="flex items-center justify-center gap-6 pb-4">
            <div className="relative">{narratorStrip}</div>
            <div className="relative">
              {speedTrigger}
              {speedMenuOpen && (
                <SpeedMenu
                  speed={speed}
                  isMobile
                  onSelect={(s) => {
                    setSpeed(s);
                    setSpeedMenuOpen(false);
                  }}
                  onClose={() => setSpeedMenuOpen(false)}
                />
              )}
            </div>
          </div>
        </>
      ) : (
        // py-2.5 (not the old pt-1 pb-3.5) — that asymmetry was what threw
        // this row's vertical centering off inside the bar's own
        // justify-center: with no progress-track row above it (the
        // streaming-narration default; see that row's own comment) it's
        // usually the *only* child, so its own padding alone decided
        // where the whole bar's content sat, and 4px top vs 14px bottom
        // pushed everything visibly toward the top.
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8 px-6 py-3">
          {coverAndMeta}
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3.5">
              {skipPrevBtn}
              {back15Btn}
              {playBtn}
              {forward15Btn}
              {skipNextBtn}
            </div>
            {narratorStrip}
            <div className="relative">
              {speedTrigger}
              {speedMenuOpen && (
                <SpeedMenu
                  speed={speed}
                  isMobile={false}
                  onSelect={(s) => {
                    setSpeed(s);
                    setSpeedMenuOpen(false);
                  }}
                  onClose={() => setSpeedMenuOpen(false)}
                />
              )}
            </div>
          </div>
          <div className="flex items-center justify-end">{closeBtn}</div>
        </div>
      )}

      {voiceMenuOpen && (
        <VoiceChangeModal
          voice={voice}
          onSelect={(v) => {
            setVoice(v);
            setVoiceMenuOpen(false);
          }}
          onClose={() => setVoiceMenuOpen(false)}
        />
      )}
    </div>
  );
}
