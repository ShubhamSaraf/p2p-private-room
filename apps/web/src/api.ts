import { type RoomCreated, isRoomId } from "@peerlink/protocol";

import { SIGNALING_URL } from "./config";

export async function createRoom(signal?: AbortSignal): Promise<RoomCreated> {
  const response = await fetch(`${SIGNALING_URL}/api/rooms`, {
    method: "POST",
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`Room creation failed with status ${response.status}`);
  }

  const value: unknown = await response.json();
  if (!isRoomCreated(value)) {
    throw new Error("The signaling service returned an invalid room");
  }

  return value;
}

export function getRoomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([^/]+)\/?$/);
  const roomId = match?.[1];
  return roomId && isRoomId(roomId) ? roomId : null;
}

function isRoomCreated(value: unknown): value is RoomCreated {
  if (typeof value !== "object" || value === null) return false;
  if (!("roomId" in value) || !("roomPath" in value)) return false;
  return (
    typeof value.roomId === "string" &&
    isRoomId(value.roomId) &&
    value.roomPath === `/r/${value.roomId}`
  );
}
