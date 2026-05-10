export type MediaProvider = "youtube" | "spotify" | "file";

export type MediaRef = {
  provider: MediaProvider;
  videoId?: string;
  spotifyTrackId?: string;
  fileUrl?: string;
  title?: string;
  durationSec?: number;
};
