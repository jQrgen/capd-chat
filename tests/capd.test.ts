import { describe, expect, it } from "vitest";
import { capdHash, compactTargetHex, sha256 } from "../src/capd";
import { bytesToHex, decodePayload, utf8ToHex } from "../src/decode";

describe("capd", () => {
  it("matches SHA-256 and the nexa message hash", () => {
    expect(bytesToHex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(capdHash(new TextEncoder().encode("hi"), 1_700_000_000, 65535, 0x1e0fffff, new Uint8Array([1, 2, 3]))).toBe(
      "c6a51fb02786606ba991bc62ee385a9c90641770711c684e5f424593dea53ac6",
    );
    expect(compactTargetHex(0x1d00ffff)).toBe("00000000ffff" + "0".repeat(52));
    expect(compactTargetHex(0x1d80ffff)).toBe(compactTargetHex(0x1d00ffff));
  });

  it("strips line separators and all bidi formatting characters", () => {
    expect(decodePayload(utf8ToHex("a\u2028b\u206ac"))?.text).toBe("abc");
  });
});
