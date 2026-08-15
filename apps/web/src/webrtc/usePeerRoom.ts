import { useCallback, useEffect, useRef, useState } from "react";

import { SIGNALING_URL } from "../config";
import {
  INITIAL_PEER_ROOM_STATE,
  PeerRoomSession,
  type PeerRoomState,
  type SendChatResult,
  type StartAuthenticationResult,
  type TransferActionResult,
} from "./PeerRoomSession";

export type PeerRoomController = PeerRoomState & {
  sendChatMessage: (text: string) => SendChatResult;
  startAuthentication: (secret: string) => Promise<StartAuthenticationResult>;
  offerFile: (file: File, category: "image" | "file") => TransferActionResult;
  acceptTransfer: (id: string) => TransferActionResult;
  declineTransfer: (id: string) => TransferActionResult;
  cancelTransfer: (id: string) => TransferActionResult;
  pauseTransfer: (id: string) => TransferActionResult;
  resumeTransfer: (id: string) => TransferActionResult;
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

  const offerFile = useCallback(
    (file: File, category: "image" | "file"): TransferActionResult =>
      sessionRef.current?.offerFile(file, category) ?? {
        ok: false,
        error: "The room is not connected yet.",
      },
    [],
  );

  const acceptTransfer = useCallback(
    (id: string): TransferActionResult =>
      sessionRef.current?.acceptTransfer(id) ?? { ok: false, error: "Transfer not found." },
    [],
  );

  const declineTransfer = useCallback(
    (id: string): TransferActionResult =>
      sessionRef.current?.declineTransfer(id) ?? { ok: false, error: "Transfer not found." },
    [],
  );

  const cancelTransfer = useCallback(
    (id: string): TransferActionResult =>
      sessionRef.current?.cancelTransfer(id) ?? { ok: false, error: "Transfer not found." },
    [],
  );

  const pauseTransfer = useCallback(
    (id: string): TransferActionResult =>
      sessionRef.current?.pauseTransfer(id) ?? { ok: false, error: "Transfer not found." },
    [],
  );

  const resumeTransfer = useCallback(
    (id: string): TransferActionResult =>
      sessionRef.current?.resumeTransfer(id) ?? { ok: false, error: "Transfer not found." },
    [],
  );

  return {
    ...state,
    sendChatMessage,
    startAuthentication,
    offerFile,
    acceptTransfer,
    declineTransfer,
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
  };
}
