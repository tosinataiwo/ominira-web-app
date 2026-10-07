// Shared TanStack Query keys for a material's own highlights/notes — one
// place so a mutation (create/delete highlight, create/edit/delete note)
// and the query it should invalidate never drift onto slightly different
// key arrays.
export const materialKeys = {
  highlights: (materialId: string) => ["materials", materialId, "highlights"] as const,
  notes: (materialId: string) => ["materials", materialId, "notes"] as const,
  // The book details page's own community-notes tab — sorted (top/recent)
  // and excerpt-enriched, a different shape/params than the flat `notes`
  // fetch above (see useBookCommunityNotes), so it gets its own key rather
  // than sharing one that would otherwise force both to always refetch
  // together. `notesFeedPrefix` (no sort) is what invalidation targets, so
  // a write invalidates every sort variant at once — same "invalidate by
  // prefix" trick communityKeys.feedPrefix already uses.
  notesFeedPrefix: (materialId: string) => ["materials", materialId, "notes-feed"] as const,
  notesFeed: (materialId: string, sort: string) => ["materials", materialId, "notes-feed", sort] as const,
  currentReaders: (materialId: string) => ["materials", materialId, "current-readers"] as const,
  room: (materialId: string) => ["materials", materialId, "room"] as const,
};
