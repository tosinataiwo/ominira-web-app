"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AudioPlayer from "./AudioPlayer";
import { useBottomDock } from "./useBottomDock";
import { useAudioStore } from "@/stores/audio-store";
import { useNarrationStore } from "@/stores/narration-store";

/**
 * The one persistent "now playing" bar — mounted once in the root layout
 * (alongside NarrationEngine, which actually drives playback) so it stays
 * fixed to the bottom of the viewport across every route, library
 * included. Renders nothing while no book is loaded for listening; the
 * reader's own X is the only thing that clears it (see audio-store's
 * closePlayer) — navigating away, including to the library, never does.
 */
export default function NowPlayingBar() {
  const book = useAudioStore((s) => s.book);
  const closePlayer = useAudioStore((s) => s.closePlayer);
  const setPlayerHeight = useAudioStore((s) => s.setPlayerHeight);
  const audioSection = useNarrationStore((s) => s.audioSection);
  const canSkipToPrevSection = useNarrationStore((s) => s.canSkipToPrevSection);
  const canSkipToNextSection = useNarrationStore((s) => s.canSkipToNextSection);
  const skipToPrevSection = useNarrationStore((s) => s.skipToPrevSection);
  const skipToNextSection = useNarrationStore((s) => s.skipToNextSection);
  const handleSeek = useNarrationStore((s) => s.handleSeek);
  const isBuffering = useNarrationStore((s) => s.isBuffering);
  const router = useRouter();
  const dock = useBottomDock();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !book) {
      setPlayerHeight(0);
      return;
    }
    const ro = new ResizeObserver((entries) => setPlayerHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [book, setPlayerHeight]);

  if (!book) return null;

  return (
    <div ref={containerRef} data-reader-theme={dock.theme} className={dock.className} style={{ bottom: dock.bottom }}>
      <AudioPlayer
        variant="full"
        bookTitle={book.metadata.title}
        chapterLabel={audioSection?.title ?? book.metadata.title}
        coverSrc={book.metadata.cover}
        isBuffering={isBuffering}
        onSeek={handleSeek}
        onSkipPrev={skipToPrevSection}
        onSkipNext={skipToNextSection}
        canSkipPrev={canSkipToPrevSection}
        canSkipNext={canSkipToNextSection}
        // A soft push straight at /reader/[slug] (not /read/[slug]) — same
        // reasoning as ReaderLink's own doc comment: that route falls
        // outside @modal's interception convention, so this bar can be
        // tapped from any page without getting hijacked into ReaderModal,
        // and without the hard reload a /read/[slug] navigation used to
        // need to dodge that.
        onTitleClick={() => {
          router.push(`/reader/${book.slug}`);
        }}
        onClose={closePlayer}
      />
    </div>
  );
}
