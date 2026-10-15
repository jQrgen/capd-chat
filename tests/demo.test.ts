import { describe, expect, it } from "vitest";
import { demoInfo, demoSeed, localDemoMessage, nextDemoMessage } from "../src/demo";

describe("demo pool", () => {
  it("seeds a mixed archive with unique hashes and one message that already left", () => {
    const now = 1_700_000_000_000;
    const seed = demoSeed(now);
    expect(new Set(seed.map((message) => message.hash)).size).toBe(seed.length);
    expect(seed.every((message) => message.hash.length === 64)).toBe(true);
    expect(seed.some((message) => message.text === null)).toBe(true);
    expect(seed.some((message) => message.text?.includes("Grüß"))).toBe(true);
    expect(seed.some((message) => !message.inPool)).toBe(true);
    expect(seed.some((message) => message.text?.includes("\n"))).toBe(true);
    const info = demoInfo(seed);
    expect(info.count).toBe(seed.filter((message) => message.inPool).length);
    expect(info.relayPriority).toBe(1);
  });

  it("gives later demo messages new hashes and keeps a typed note as text", () => {
    const first = nextDemoMessage(0, 1_700_000_000_000);
    const second = nextDemoMessage(1, 1_700_000_009_000);
    expect(first.hash).not.toBe(second.hash);
    expect(second.created).toBeGreaterThan(first.created);
    const note = localDemoMessage("6869", 1_700_000_010_000);
    expect(note.text).toBe("hi");
    expect(note.origin).toBe("local");
    expect(note.hash).toHaveLength(64);
  });
});
