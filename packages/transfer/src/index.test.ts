import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import {
  TRANSFER_CHUNK_SIZE,
  TransferHasher,
  chunkCount,
  createSingleFileZip,
  decodeTransferChunk,
  encodeTransferChunk,
  isProbablyCompressed,
  isValidResumePoint,
} from "./index";

const transferId = "9f23ce7e-1821-4b74-b60a-0d8185631d99";

describe("transfer primitives", () => {
  it("round-trips compact binary chunks", () => {
    const data = Uint8Array.from([1, 2, 3, 4]);
    expect(decodeTransferChunk(encodeTransferChunk({ transferId, chunkIndex: 42, data }))).toEqual({
      transferId,
      chunkIndex: 42,
      data,
    });
  });

  it("rejects oversized and malformed chunks", () => {
    expect(() =>
      encodeTransferChunk({
        transferId,
        chunkIndex: 0,
        data: new Uint8Array(TRANSFER_CHUNK_SIZE + 1),
      }),
    ).toThrow(/1-/);
    expect(() => decodeTransferChunk(Uint8Array.from([99, 1, 2]))).toThrow(/Invalid/);
  });

  it("hashes streamed chunks with SHA-256", () => {
    const hasher = new TransferHasher();
    hasher.update(new TextEncoder().encode("abc"));
    expect(hasher.digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("calculates chunk counts without reading file data", () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(TRANSFER_CHUNK_SIZE)).toBe(1);
    expect(chunkCount(TRANSFER_CHUNK_SIZE + 1)).toBe(2);
    expect(isValidResumePoint(TRANSFER_CHUNK_SIZE * 3, 2, TRANSFER_CHUNK_SIZE * 2)).toBe(true);
    expect(isValidResumePoint(TRANSFER_CHUNK_SIZE * 3, 1, TRANSFER_CHUNK_SIZE * 2)).toBe(false);
    expect(isValidResumePoint(TRANSFER_CHUNK_SIZE + 7, 2, TRANSFER_CHUNK_SIZE + 7)).toBe(true);
  });

  it("creates interoperable ZIP files and flags compressed formats", () => {
    const zipped = createSingleFileZip("../notes.txt", new TextEncoder().encode("hello"));
    const entries = unzipSync(zipped);
    expect(strFromU8(entries["notes.txt"] ?? new Uint8Array())).toBe("hello");
    expect(isProbablyCompressed("photo.PNG")).toBe(true);
    expect(isProbablyCompressed("dataset.csv")).toBe(false);
  });
});
