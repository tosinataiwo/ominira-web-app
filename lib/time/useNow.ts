"use client";

import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs`, for labels that age
 * ("48 min", "2 minutes ago") while on screen. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
