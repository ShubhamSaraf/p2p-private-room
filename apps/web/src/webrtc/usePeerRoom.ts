import { useEffect, useState } from "react";

import { SIGNALING_URL } from "../config";
import { INITIAL_PEER_ROOM_STATE, PeerRoomSession, type PeerRoomState } from "./PeerRoomSession";

export function usePeerRoom(roomId: string): PeerRoomState {
  const [state, setState] = useState<PeerRoomState>(INITIAL_PEER_ROOM_STATE);

  useEffect(() => {
    const session = new PeerRoomSession({
      roomId,
      signalingUrl: SIGNALING_URL,
      onStateChange: setState,
    });
    session.connect();
    return () => session.disconnect();
  }, [roomId]);

  return state;
}
