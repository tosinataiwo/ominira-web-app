import "server-only";

// ICE servers for a Reading Room session (reading-room-spec.md §8.4, §8.9):
// short-lived Cloudflare TURN credentials, minted per join so the API token
// never reaches the client. The TTL covers a long session.
const TTL_SECONDS = 6 * 60 * 60;

// Without TURN keys (local dev) or if Cloudflare is down, peers still connect
// directly on most networks; only TURN-dependent networks (UDP-blocked) fail.
const STUN_ONLY: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

export async function getIceServers(): Promise<RTCIceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return STUN_ONLY;

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}`);
    const { iceServers } = (await res.json()) as { iceServers: RTCIceServer | RTCIceServer[] };
    return [iceServers].flat().map(withoutPort53);
  } catch (err) {
    console.error("[room] TURN credentials failed, falling back to STUN", err);
    return STUN_ONLY;
  }
}

// Browsers block port 53, so those URLs only add ICE timeouts (Cloudflare's
// own advice is to drop them).
function withoutPort53(server: RTCIceServer): RTCIceServer {
  const urls = [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url));
  return { ...server, urls };
}
