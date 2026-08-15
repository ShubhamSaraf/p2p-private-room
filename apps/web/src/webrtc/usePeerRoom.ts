import { useCallback, useEffect, useRef, useState } from "react";

import { SIGNALING_URL } from "../config";
import {
  INITIAL_PEER_ROOM_STATE,
  PeerRoomSession,
  type PeerRoomState,
  type SendChatResult,
} from "./PeerRoomSession";

export type PeerRoomController = PeerRoomState & {
  sendChatMessage: (text: string) => SendChatResult;
};

export function usePeerRoom(roomId: string): PeerRoomController {
  const [state, setState] = useState<PeerRoomState>(INITIAL_PEER_ROOM_STATE);
  const sessionRef = useRef<PeerRoomSession | null>(null);

  useEffect(() => {
    const session = new PeerRoomSession({
      roomId,
      signalingUrl: SIGNALING_URL,
      onStateChange: setState,
    });
    sessionRef.current = session;
    session.connect();
    return () => {
      session.disconnect();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [roomId]);

  const sendChatMessage = useCallback((text: string): SendChatResult => {
    return (
      sessionRef.current?.sendChatMessage(text) ?? {
        ok: false,
        error: "The room is not connected yet.",
      }
    );
  }, []);

  return { ...state, sendChatMessage };
}
