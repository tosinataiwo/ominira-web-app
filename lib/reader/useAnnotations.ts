import { useMemo } from "react";
import { useHighlights } from "@/lib/materials/useHighlights";
import { useMaterialNotes } from "@/lib/materials/useMaterialNotes";
import { buildAnnotationsForPassage, type Annotation } from "@/stores/library-store";
import type { AnnotationRange } from "@/lib/api/types";

const EMPTY: never[] = [];

function bucketByPassage<T extends { ranges: AnnotationRange[] }>(rows: T[]): Record<string, T[]> {
  const byPassage: Record<string, T[]> = {};
  for (const row of rows) {
    for (const r of row.ranges) {
      (byPassage[r.passageId] ??= []).push(row);
    }
  }
  return byPassage;
}

/**
 * The single source of a material's Annotation[] view, fed by two real
 * server queries (the caller's own highlights, every visible community
 * note) rather than a zustand store — see stores/library-store.ts's own
 * doc comment for the fuller history. Computes the full per-passage
 * grouping once (memoized on the query results themselves), so repeated
 * per-passage lookups during render stay O(1) the same way the old
 * store-backed `annotationsByPassage` cache did.
 */
export function useAnnotations(materialId: string) {
  const { data: highlights = EMPTY } = useHighlights(materialId);
  const { data: notes = EMPTY } = useMaterialNotes(materialId);

  const highlightsByPassage = useMemo(() => bucketByPassage(highlights), [highlights]);
  const notesByPassage = useMemo(() => bucketByPassage(notes), [notes]);

  const annotationsByPassage = useMemo(() => {
    const passageIds = new Set([...Object.keys(highlightsByPassage), ...Object.keys(notesByPassage)]);
    const map: Record<string, Annotation[]> = {};
    for (const passageId of passageIds) {
      map[passageId] = buildAnnotationsForPassage(highlightsByPassage[passageId] ?? [], notesByPassage[passageId] ?? []);
    }
    return map;
  }, [highlightsByPassage, notesByPassage]);

  // Every Annotation in the material, deduped by id (a multi-passage
  // annotation lands in more than one passage's bucket, same object
  // reference) — for the book-wide annotation feed, not per-passage
  // rendering (see useFeed).
  const allAnnotations = useMemo(() => {
    const byId = new Map<string, Annotation>();
    for (const list of Object.values(annotationsByPassage)) {
      for (const a of list) if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return Array.from(byId.values());
  }, [annotationsByPassage]);

  return { highlights, notes, annotationsByPassage, allAnnotations };
}
