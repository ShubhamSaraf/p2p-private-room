import { useCallback, useEffect, useRef, useState } from "react";

import { SIGNALING_URL } from "../config";
import {
  INITIAL_PEER_ROOM_STATE,
  PeerRoomSession,
  type PeerRoomState,
  type SendChatResult,
  type StartAuthenticationResult,
} from "./PeerRoomSession";

export type PeerRoomController = PeerRoomState & {
  sendChatMessage: (text: string) => SendChatResult;
  startAuthentication: (secret: string) => Promise<StartAuthenticationResult>;
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

  const startAuthentication = useCallback(
    async (secret: string): Promise<StartAuthenticationResult> => {
      return (
        (await sessionRef.current?.startAuthentication(secret)) ?? {
          ok: false,
          error: "The room is not connected yet.",
        }
      );
    },
    [],
  );

  return { ...state, sendChatMessage, startAuthentication };
}
