import { describe, expect, it } from "vitest";
import { loadSettings, memoryStore, saveSettings } from "../src/store";
import type { Settings, StoredMessage } from "../src/types";

function message(): StoredMessage {
  return {
    hash: "11".repeat(32),
    created: 10,
    difficultyBits: 1,
    priority: 1,
    initialPriority: 1,
    powTarget: "00ff",
    nonce: "01",
    size: 4,
    data: "6869",
    text: "hi",
    inPool: true,
    server: "demo",
    origin: "network",
    firstSeen: 1,
    lastSeen: 1,
  };
}

describe("memoryStore", () => {
  it("stores copies and can clear them", async () => {
    const store = memoryStore();
    const original = message();
    await store.putMany([original]);
    original.text = "changed";
    const loaded = await store.getAll();
    expect(loaded[0]?.text).toBe("hi");
    loaded[0]!.text = "mutated";
    expect((await store.getAll())[0]?.text).toBe("hi");
    await store.clearAll();
    expect(await store.getAll()).toEqual([]);
  });
});

describe("settings", () => {
  it("round-trips and falls back when the saved value is junk", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => void mem.set(key, value),
      removeItem: (key: string) => void mem.delete(key),
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    const settings: Settings = {
      preset: "custom",
      customUrl: "wss://localhost:20004",
      active: "server",
      serverUrl: "wss://localhost:20004",
      autoConnect: true,
    };
    saveSettings(settings, storage);
    expect(loadSettings(storage)).toEqual(settings);
    storage.setItem("capd-chat.settings", "{");
    expect(loadSettings(storage).preset).toBe("demo");
  });
});
