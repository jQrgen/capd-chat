import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatClock,
  formatDifficulty,
  formatExpiration,
  formatHexPreview,
  formatPriority,
  formatRelative,
  serverLabel,
  shortHash,
} from "../src/format";

describe("formatters", () => {
  it("formats priority, difficulty, and sizes", () => {
    expect(formatPriority(2.5)).toBe("2.5");
    expect(formatPriority(1_500_000)).toBe("1.50e+6");
    expect(formatPriority(Number.NaN)).toBe("—");
    expect(formatDifficulty(486604799)).toBe("1d00ffff");
    expect(formatBytes(40)).toBe("40 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("describes age and expiration from a fixed clock", () => {
    const now = 1_700_000_100_000;
    expect(formatRelative(1_700_000_000, now)).toBe("1m ago");
    expect(formatRelative(1_700_000_095, now)).toBe("just now");
    expect(formatExpiration(1_700_000_000, undefined, 1_700_000_100)).toBe("no expiry");
    expect(formatExpiration(1_700_000_000, 60, 1_700_000_100)).toBe("expired");
    expect(formatExpiration(1_700_000_000, 600, 1_700_000_100)).toBe("expires in 9m");
  });

  it("groups hex and shortens hashes without claiming a timezone", () => {
    expect(formatHexPreview("6869", 64).text).toBe("68 69");
    expect(formatHexPreview("aa".repeat(80), 16).truncated).toBe(true);
    expect(shortHash("ab".repeat(32))).toBe("ababab…abab");
    expect(serverLabel("demo")).toBe("Demo");
    expect(serverLabel("wss://electrum.nexa.org:20004")).toBe("electrum.nexa.org:20004");
    expect(formatClock(1_700_000_000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClock(Number.NaN)).toBe("—");
  });
});
