import { sha256 } from "@noble/hashes/sha256";
import { zipSync } from "fflate";

export const TRANSFER_CHUNK_SIZE = 64 * 1024;
export const TRANSFER_BUFFER_HIGH_WATER = 4 * 1024 * 1024;
export const TRANSFER_BUFFER_LOW_WATER = 1024 * 1024;
export const TRANSFER_CHUNK_HEADER_BYTES = 21;

const CHUNK_FRAME_KIND = 1;

export type TransferChunk = {
  transferId: string;
  chunkIndex: number;
  data: Uint8Array;
};

export function encodeTransferChunk(chunk: TransferChunk): Uint8Array {
  if (!isUuid(chunk.transferId)) throw new Error("Transfer ID must be a UUID.");
  if (
    !Number.isSafeInteger(chunk.chunkIndex) ||
    chunk.chunkIndex < 0 ||
    chunk.chunkIndex > 0xffffffff
  ) {
    throw new Error("Transfer chunk index is out of range.");
  }
  if (chunk.data.length === 0 || chunk.data.length > TRANSFER_CHUNK_SIZE) {
    throw new Error(`Transfer chunks must contain 1-${TRANSFER_CHUNK_SIZE} bytes.`);
  }

  const frame = new Uint8Array(TRANSFER_CHUNK_HEADER_BYTES + chunk.data.length);
  frame[0] = CHUNK_FRAME_KIND;
  frame.set(uuidToBytes(chunk.transferId), 1);
  new DataView(frame.buffer).setUint32(17, chunk.chunkIndex, false);
  frame.set(chunk.data, TRANSFER_CHUNK_HEADER_BYTES);
  return frame;
}

export function decodeTransferChunk(frame: Uint8Array): TransferChunk {
  if (frame.length <= TRANSFER_CHUNK_HEADER_BYTES || frame[0] !== CHUNK_FRAME_KIND) {
    throw new Error("Invalid transfer chunk frame.");
  }
  const data = frame.slice(TRANSFER_CHUNK_HEADER_BYTES);
  if (data.length > TRANSFER_CHUNK_SIZE) throw new Error("Transfer chunk is too large.");
  return {
    transferId: bytesToUuid(frame.subarray(1, 17)),
    chunkIndex: new DataView(frame.buffer, frame.byteOffset + 17, 4).getUint32(0, false),
    data,
  };
}

export class TransferHasher {
  private readonly hash = sha256.create();
  private finished = false;

  update(data: Uint8Array): void {
    if (this.finished) throw new Error("Transfer hash is already finalized.");
    this.hash.update(data);
  }

  digestHex(): string {
    if (this.finished) throw new Error("Transfer hash is already finalized.");
    this.finished = true;
    return bytesToHex(this.hash.digest());
  }
}

export async function waitForTransferCapacity(
  channel: RTCDataChannel,
  signal?: AbortSignal,
): Promise<void> {
  if (channel.readyState !== "open") throw new Error("Transfer DataChannel is not open.");
  if (channel.bufferedAmount <= TRANSFER_BUFFER_HIGH_WATER) return;

  channel.bufferedAmountLowThreshold = TRANSFER_BUFFER_LOW_WATER;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Transfer DataChannel closed."));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Transfer cancelled.", "AbortError"));
    };
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function chunkCount(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid file size.");
  return Math.ceil(size / TRANSFER_CHUNK_SIZE);
}

export function isValidResumePoint(
  fileSize: number,
  nextChunk: number,
  byteOffset: number,
): boolean {
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < 0 ||
    !Number.isSafeInteger(nextChunk) ||
    nextChunk < 0 ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0 ||
    byteOffset > fileSize
  ) {
    return false;
  }
  if (byteOffset === fileSize) return nextChunk === chunkCount(fileSize);
  return byteOffset % TRANSFER_CHUNK_SIZE === 0 && nextChunk === byteOffset / TRANSFER_CHUNK_SIZE;
}

export function createSingleFileZip(name: string, data: Uint8Array): Uint8Array {
  const baseName = name.split(/[\\/]/u).pop() || "file";
  const safeName = Array.from(baseName, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? "_" : character;
  }).join("");
  return zipSync({ [safeName]: data }, { level: 6 });
}

export function isProbablyCompressed(name: string): boolean {
  return /\.(?:7z|avif|br|bz2|gif|gz|heic|jpeg|jpg|m4a|mkv|mov|mp3|mp4|png|rar|webm|webp|xz|zip)$/iu.test(
    name,
  );
}

function uuidToBytes(uuid: string): Uint8Array {
  return Uint8Array.from(uuid.replace(/-/g, "").match(/.{2}/g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );
}

function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new Error("UUID data must be 16 bytes.");
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
