import type { ChatEntry } from "./webrtc/PeerRoomSession";

const DATABASE_NAME = "peerlink-local-history";
const DATABASE_VERSION = 1;
const CHAT_STORE = "chat";
const SETTINGS_STORE = "settings";
const HISTORY_SETTING = "saveChatsLocally";

type StoredChatEntry = ChatEntry & { roomId: string };
type StoredSetting = { key: string; value: boolean };

export async function getLocalHistoryEnabled(): Promise<boolean> {
  const database = await openDatabase();
  const result = await requestResult<StoredSetting | undefined>(
    database.transaction(SETTINGS_STORE).objectStore(SETTINGS_STORE).get(HISTORY_SETTING),
  );
  database.close();
  return result?.value === true;
}

export async function setLocalHistoryEnabled(enabled: boolean): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SETTINGS_STORE, "readwrite");
  transaction.objectStore(SETTINGS_STORE).put({ key: HISTORY_SETTING, value: enabled });
  await transactionComplete(transaction);
  database.close();
}

export async function loadRoomMessages(roomId: string): Promise<ChatEntry[]> {
  const database = await openDatabase();
  const transaction = database.transaction(CHAT_STORE);
  const index = transaction.objectStore(CHAT_STORE).index("roomId");
  const messages = await requestResult<StoredChatEntry[]>(index.getAll(roomId));
  await transactionComplete(transaction);
  database.close();
  return messages
    .map((message) => ({
      type: message.type,
      id: message.id,
      timestamp: message.timestamp,
      text: message.text,
      direction: message.direction,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export async function saveRoomMessages(roomId: string, messages: ChatEntry[]): Promise<void> {
  if (messages.length === 0) return;
  const database = await openDatabase();
  const transaction = database.transaction(CHAT_STORE, "readwrite");
  const store = transaction.objectStore(CHAT_STORE);
  for (const message of messages) store.put({ ...message, roomId });
  await transactionComplete(transaction);
  database.close();
}

export async function clearLocalHistory(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(CHAT_STORE, "readwrite");
  transaction.objectStore(CHAT_STORE).clear();
  await transactionComplete(transaction);
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CHAT_STORE)) {
        database
          .createObjectStore(CHAT_STORE, { keyPath: ["roomId", "id"] })
          .createIndex("roomId", "roomId");
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB failed")));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB failed")));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Aborted")));
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Failed")));
  });
}
