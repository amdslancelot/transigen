"use client";

import { useEffect } from "react";
import { incrementRoomPlayCount } from "@/app/actions";

/** Counts one “play” per browser tab session when viewing a room (see /room popularity). */
export function RoomPlayIncrement({ roomId }: { roomId: string }) {
  useEffect(() => {
    if (typeof window === "undefined" || !roomId) return;
    const key = `room-play-inc:${roomId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    void incrementRoomPlayCount(roomId);
  }, [roomId]);
  return null;
}
