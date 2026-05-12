/**
 * Spotify Web API helpers (server-only) using Client Credentials flow.
 * Tempo (BPM) comes from /audio-features/{id}.
 */

export type SpotifyTrackHit = {
  trackId: string;
  name: string;
  artists: string;
  album: string;
  durationMs: number;
  raw: unknown;
};

export type SpotifyAudioFeatures = {
  trackId: string;
  bpm: number;
  timeSignature: number | null;
  key: number | null;
  mode: number | null;
  energy: number | null;
  danceability: number | null;
  raw: unknown;
};

type SpotifyTrackApi = {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
};

type SpotifyAudioFeaturesApi = {
  id: string;
  tempo: number;
  time_signature?: number;
  key?: number;
  mode?: number;
  energy?: number;
  danceability?: number;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function getCreds() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in environment.");
  }
  return { id, secret };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }
  const { id, secret } = getCreds();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify auth ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

export async function searchSpotifyTrack(
  title: string,
  artist?: string,
): Promise<SpotifyTrackHit | null> {
  const token = await getAccessToken();
  const q = artist ? `track:${title} artist:${artist}` : title;

  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify search ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { tracks?: { items: SpotifyTrackApi[] } };
  const t = data.tracks?.items?.[0];
  if (!t) return null;
  return {
    trackId: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    album: t.album?.name ?? "",
    durationMs: t.duration_ms,
    raw: t,
  };
}

export async function fetchSpotifyAudioFeatures(
  trackId: string,
): Promise<SpotifyAudioFeatures | null> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify audio-features ${res.status}: ${body.slice(0, 200)}`);
  }
  const f = (await res.json()) as SpotifyAudioFeaturesApi;
  if (!f || typeof f.tempo !== "number") return null;
  return {
    trackId,
    bpm: Math.round(f.tempo * 100) / 100,
    timeSignature: f.time_signature ?? null,
    key: f.key ?? null,
    mode: f.mode ?? null,
    energy: f.energy ?? null,
    danceability: f.danceability ?? null,
    raw: f,
  };
}
