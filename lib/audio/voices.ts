import type { EngineVoice } from "@/lib/audio/engines/types";

/**
 * The Edge TTS engine's (lib/audio/engines/edge.ts) full voice set covers
 * dozens of locales, but the reader-facing switcher only offers African
 * English ones, on purpose — one Neural voice per major English-speaking
 * African market Microsoft ships: Nigeria, Kenya, Tanzania, South Africa,
 * a woman and a man each. Labeled with the voice's own given name (each id
 * already carries a real one — Ezinne, Asilia, Imani, Leah, ...) plus its
 * country, the same "Name (Region)" pattern the engine's non-African
 * voices already used.
 *
 * Kept in this standalone, dependency-free file — not inline in edge.ts —
 * specifically so it can be imported from client code too (audio-store's
 * persisted preference, AudioPlayer's switcher UI) without pulling in
 * edge.ts's own `ws`/`node:crypto` imports, which only run server-side.
 */
export type AfricanVoice = EngineVoice & { name: string; country: string; traits: string; avatar: string };

export const AFRICAN_VOICES: AfricanVoice[] = [
  { id: "en-ZA-LeahNeural", label: "Leah (South Africa)", name: "Leah", country: "South Africa", traits: "Warm · Grounded", avatar: "/images/avatars/leah.png" },
  { id: "en-TZ-ElimuNeural", label: "Elimu (Tanzania)", name: "Elimu", country: "Tanzania", traits: "Clear · Confident", avatar: "/images/avatars/elimu.png" },
  { id: "en-TZ-ImaniNeural", label: "Imani (Tanzania)", name: "Imani", country: "Tanzania", traits: "Gentle · Encouraging", avatar: "/images/avatars/imani.png" },
  { id: "en-NG-AbeoNeural", label: "Abeodun (Nigeria)", name: "Abiodun", country: "Nigeria", traits: "Deep · Measured", avatar: "/images/avatars/abeodun.png" },
  { id: "en-KE-AsiliaNeural", label: "Asilia (Kenya)", name: "Asilia", country: "Kenya", traits: "Clear · Intimate", avatar: "/images/avatars/asilia.png" },
  { id: "en-KE-ChilembaNeural", label: "Chilemba (Kenya)", name: "Sadiku", country: "Kenya", traits: "Calm · Steady", avatar: "/images/avatars/chilemba.png" },
  { id: "en-NG-EzinneNeural", label: "Ezinne (Nigeria)", name: "Chidinma", country: "Nigeria", traits: "Warm · Expressive", avatar: "/images/avatars/ezinne.png" },
  { id: "en-ZA-LukeNeural", label: "Xuma (South Africa)", name: "Xuma", country: "South Africa", traits: "Rich · Calm", avatar: "/images/avatars/xuma.png" },
];

export const DEFAULT_VOICE_ID = AFRICAN_VOICES[0].id;

export const voiceById = (id: string | null | undefined): AfricanVoice | undefined =>
  id ? AFRICAN_VOICES.find((v) => v.id === id) : undefined;
