/* global crypto, console */

import { performance } from "node:perf_hooks";
import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha256";

const chunkBytes = 64 * 1024;
const totalBytes = 64 * 1024 * 1024;
const iterations = totalBytes / chunkBytes;
const chunk = new Uint8Array(chunkBytes);
crypto.getRandomValues(chunk);
const key = new Uint8Array(32);
crypto.getRandomValues(key);

const hashStart = performance.now();
const hasher = sha256.create();
for (let index = 0; index < iterations; index += 1) hasher.update(chunk);
hasher.digest();
const hashDuration = performance.now() - hashStart;

const encryptionStart = performance.now();
for (let index = 0; index < iterations; index += 1) {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(index), false);
  gcm(key, nonce).encrypt(chunk);
}
const encryptionDuration = performance.now() - encryptionStart;

console.log(
  JSON.stringify(
    {
      chunkKiB: chunkBytes / 1024,
      sampleMiB: totalBytes / 1024 / 1024,
      sha256MiBPerSecond: throughput(totalBytes, hashDuration),
      aesGcmMiBPerSecond: throughput(totalBytes, encryptionDuration),
    },
    null,
    2,
  ),
);

function throughput(bytes, milliseconds) {
  return Number((bytes / 1024 / 1024 / (milliseconds / 1_000)).toFixed(1));
}
