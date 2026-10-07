/** iPhone, iPod or iPad, in any browser (all of them are Safari underneath). */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ identifies itself as "MacIntel" in navigator.platform (it
  // dropped the "iPad" UA token to get desktop sites by default) — the
  // touch-points check is what actually distinguishes it from a real Mac.
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}
