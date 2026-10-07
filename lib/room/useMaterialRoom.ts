"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { materialKeys } from "@/lib/materials/queryKeys";
import type { MaterialRoom } from "@/lib/room/types";

/** `GET /api/materials/{materialId}/room` — the book's live room and whether
 * one can start (spec §11: a query, not a subscription). Refreshed every
 * minute while shown, so the Live chip's count stays roughly current. */
export function useMaterialRoom(materialId: string) {
  return useQuery({
    queryKey: materialKeys.room(materialId),
    queryFn: () => apiFetch<MaterialRoom>(`/materials/${materialId}/room`),
    enabled: Boolean(materialId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
