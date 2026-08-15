import { describe, expect, it } from "vitest";

import { PRODUCT_NAME, SIGNALING_PROTOCOL_VERSION } from "./index";

describe("shared protocol metadata", () => {
  it("exposes a stable product name and protocol version", () => {
    expect(PRODUCT_NAME).toBe("PeerLink");
    expect(SIGNALING_PROTOCOL_VERSION).toBe(1);
  });
});
