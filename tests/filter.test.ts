import { describe, expect, it } from "vitest";
import { visibleMessages } from "../src/filter";
import type { StoredMessage } from "../src/types";

function message(patch: Partial<StoredMessage> & Pick<StoredMessage, "hash" | "created">): StoredMessage {
  return {
    expiration: undefined,
    difficultyBits: 1,
    priority: 1,
    initialPriority: 1,
    powTarget: "00ff",
    nonce: "01",
    size: 10,
    data: "6869",
    text: "hi",
    inPool: true,
    server: "demo",
    origin: "network",
    firstSeen: patch.created * 1000,
    lastSeen: patch.created * 1000,
    ...patch,
  };
}

const older = message({ hash: "aa".repeat(32), created: 100, text: "swap BTC" });
const newer = message({ hash: "bb".repeat(32), created: 200, text: null, data: "00ff", inPool: true });
const kept = message({ hash: "cc".repeat(32), created: 150, text: "filled offer", inPool: false, server: "wss://other:20004" });

describe("visibleMessages", () => {
  it("puts the newest message last", () => {
    const shown = visibleMessages([newer, older, kept], { query: "", kind: "all", presence: "all", server: null });
    expect(shown.map((item) => item.hash)).toEqual([older.hash, kept.hash, newer.hash]);
  });

  it("filters by text, hex, presence, server, and a spaced hex query", () => {
    const all = [older, newer, kept];
    expect(visibleMessages(all, { query: "btc", kind: "all", presence: "all", server: "demo" }).map((item) => item.hash)).toEqual([
      older.hash,
    ]);
    expect(visibleMessages(all, { query: "00 ff", kind: "hex", presence: "pool", server: null }).map((item) => item.hash)).toEqual([
      newer.hash,
    ]);
    expect(visibleMessages(all, { query: "", kind: "text", presence: "kept", server: null }).map((item) => item.hash)).toEqual([
      kept.hash,
    ]);
  });
});
