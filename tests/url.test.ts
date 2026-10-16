import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "../src/url";

describe("normalizeServerUrl", () => {
  it("defaults a bare host to Nexa mainnet WSS", () => {
    expect(normalizeServerUrl("electrum.nexa.org")).toBe("wss://electrum.nexa.org:20004");
    expect(normalizeServerUrl(" electrum.nexa.org:20003 ")).toBe("wss://electrum.nexa.org:20003");
  });

  it("keeps a full WebSocket URL, including its path, and drops a trailing slash", () => {
    expect(normalizeServerUrl("wss://electrum.nexa.org:20004/")).toBe("wss://electrum.nexa.org:20004");
    expect(normalizeServerUrl("ws://127.0.0.1:30403")).toBe("ws://127.0.0.1:30403");
    expect(normalizeServerUrl("wss://example.com/capd")).toBe("wss://example.com/capd");
  });

  it("rejects other schemes and empty input", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("https://electrum.nexa.org")).toBeNull();
    expect(normalizeServerUrl("wss://user:pass@host")).toBeNull();
  });
});
