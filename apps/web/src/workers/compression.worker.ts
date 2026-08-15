/// <reference lib="webworker" />

import { createSingleFileZip } from "@peerlink/transfer";

type CompressionRequest = { file: File };

self.addEventListener("message", async (event: MessageEvent<CompressionRequest>) => {
  try {
    self.postMessage({ type: "progress", progress: 10 });
    const source = new Uint8Array(await event.data.file.arrayBuffer());
    self.postMessage({ type: "progress", progress: 45 });
    const compressed = createSingleFileZip(event.data.file.name, source);
    source.fill(0);
    self.postMessage(
      {
        type: "complete",
        name: `${event.data.file.name}.zip`,
        lastModified: event.data.file.lastModified,
        originalSize: event.data.file.size,
        bytes: compressed.buffer,
      },
      { transfer: [compressed.buffer] },
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Compression failed.",
    });
  }
});
