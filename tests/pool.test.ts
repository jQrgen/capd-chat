import { describe, expect, it } from "vitest";
import { capStored, MAX_LIST, departedHashes, mergePulled, parseCapdInfo, parseCapdList, parseCapdMessage, planFetch, pullPool, snapshotIsComplete, stampMessage } from "../src/pool";
import type { StoredMessage } from "../src/types";

const HASH_A = "aa".repeat(32);
const HASH_B = "bb".repeat(32);
const HASH_C = "cc".repeat(32);
const HASH_D = "dd".repeat(32);

const sample = {
  hash: "aa".repeat(32),
  created: 1_700_000_000,
  expiration: 600,
  difficultyBits: 486604799,
  priority: 1.5,
  initialPriority: 2.5,
  powTarget: "00000000000000000000000000000000000000000000000000000000000000ff",
  nonce: "00ff",
  size: 40,
  data: "6869",
};

describe("CAPD response parsing", () => {
  it("keeps the Rostrum capd.get shape and treats 65535 as no expiration", () => {
    const parsed = parseCapdMessage(sample);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.message.text).toBe("hi");
    expect(parsed.message.expiration).toBe(600);
    expect(parsed.message.powTarget.endsWith("ff")).toBe(true);

    const forever = parseCapdMessage({ ...sample, expiration: 65535 });
    expect(forever.ok).toBe(true);
    if (!forever.ok) return;
    expect(forever.message.expiration).toBeUndefined();
  });

  it("rejects out-of-range created and caps the list", () => {
    expect(parseCapdMessage({ ...sample, created: 5 }).ok).toBe(false);
    expect(parseCapdMessage({ ...sample, created: 1_700_000_500 }, 1_700_000_000).ok).toBe(false);
    expect(parseCapdList(Array(MAX_LIST + 5).fill(HASH_A))).toHaveLength(MAX_LIST);
  });

  it("keeps the same hash from two servers apart and caps storage", () => {
    const base = (parseCapdMessage(sample) as { ok: true; message: Omit<StoredMessage, "inPool" | "server" | "origin" | "firstSeen" | "lastSeen"> }).message;
    const merged = mergePulled([stampMessage(base, "wss://a", 1)], [stampMessage(base, "wss://b", 2)], null, 2);
    expect(merged.map((message) => message.server).sort()).toEqual(["wss://a", "wss://b"]);
    const { kept, dropped } = capStored(merged, 1);
    expect(kept).toHaveLength(1);
    expect(dropped[0]?.server).toBe("wss://a");
  });

  it("parses info and a lowest-to-highest hash list", () => {
    expect(parseCapdInfo({ size: 1280, count: 4, minPriority: 0.5, maxPriority: 3.25, relayPriority: 1 })).toEqual({
      size: 1280,
      count: 4,
      minPriority: 0.5,
      maxPriority: 3.25,
      relayPriority: 1,
    });
    expect(parseCapdList([HASH_A.toUpperCase(), HASH_B])).toEqual([HASH_A, HASH_B]);
    expect(parseCapdList(["abcd"])).toBeNull();
    expect(parseCapdMessage({ ...sample, data: "abc" }).ok).toBe(false);
  });
});

describe("pool sync planning", () => {
  it("fetches unknown hashes from the high-priority end", () => {
    expect(planFetch([HASH_A, HASH_B, HASH_C, HASH_D], new Set([HASH_D]), 2)).toEqual({
      fetch: [HASH_C, HASH_B],
      remaining: 1,
    });
  });

  it("does not treat a truncated list as departures", () => {
    expect(snapshotIsComplete(2, 2)).toBe(true);
    expect(snapshotIsComplete(5, 2)).toBe(false);
    expect(departedHashes([HASH_A], new Set([HASH_A, HASH_B]), true)).toEqual([HASH_B]);
    expect(departedHashes([HASH_A], new Set([HASH_A, HASH_B]), false)).toBeNull();
  });

  it("keeps local history when a message leaves, and refreshes priority when it returns", () => {
    const stamped = stampMessage(
      { ...(parseCapdMessage(sample) as { ok: true; message: Omit<StoredMessage, "inPool" | "server" | "origin" | "firstSeen" | "lastSeen"> }).message },
      "wss://example:20004",
      5_000,
    );
    const kept = mergePulled([stamped], [], [HASH_A], 9_000);
    expect(kept[0]?.inPool).toBe(false);
    expect(kept[0]?.firstSeen).toBe(5_000);

    const returned = stampMessage(stamped, "wss://example:20004", 12_000);
    returned.priority = 0.2;
    const merged = mergePulled(kept, [returned], null, 12_000);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.inPool).toBe(true);
    expect(merged[0]?.priority).toBe(0.2);
    expect(merged[0]?.firstSeen).toBe(5_000);
  });
});

describe("pullPool", () => {
  it("loads capped messages and skips a hash that disappeared", async () => {
    const rpc = {
      info: async () => ({ size: 80, count: 3, minPriority: 0.1, maxPriority: 2, relayPriority: 0.4 }),
      list: async () => [HASH_A, HASH_B, HASH_C],
      get: async (hash: string) => {
        if (hash === HASH_C) throw Object.assign(new Error("no such CAPD message"), { code: -32004 });
        return { ...sample, hash, data: hash === HASH_B ? "00ff" : "6869" };
      },
    };
    const pulled = await pullPool(rpc, "wss://node:20004", new Set(), new Set(), 10_000, 2);
    expect(pulled.messages.map((message) => message.hash)).toEqual([HASH_B]);
    expect(pulled.skipped).toBe(1);
    expect(pulled.remaining).toBe(1);
    expect(pulled.departed).toEqual([]);
    expect(pulled.messages[0]?.text).toBeNull();
  });
});
