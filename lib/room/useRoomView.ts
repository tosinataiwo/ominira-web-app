import { useEffect, useRef } from "react";
import type { AnnotationRange } from "@/lib/api/types";
import type { ReaderView } from "@/lib/room/view";
import { useRoomStore } from "@/stores/room-store";

/**
 * Registers an open reader with the room (spec §9) while it's mounted: its
 * view (lib/room/view.ts) and the reader's current selection (the speaker
 * band shows a speaker's). A new view replaces the last one directly, with
 * no null between, so the room sees one move, not a leave and a return.
 * Every format calls this once; outside a room it only sets store fields.
 */
export function useRoomView(view: ReaderView | null, selection: readonly AnnotationRange[] | null) {
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
    useRoomStore.getState().setView(view);
  }, [view]);
  // Gone with the reader (unless another one has registered since).
  useEffect(
    () => () => {
      const { view, setView, setSelection } = useRoomStore.getState();
      if (view === latest.current) setView(null);
      setSelection(null);
    },
    [],
  );

  useEffect(() => {
    if (view) useRoomStore.getState().setSelection(selection);
  }, [view, selection]);
}
