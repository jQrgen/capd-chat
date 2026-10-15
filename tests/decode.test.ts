import { describe, expect, it } from "vitest";
import { decodePayload, isMessageHash, isReadableText, payloadForSend, utf8ToHex } from "../src/decode";

describe("decodePayload", () => {
  it("shows valid UTF-8 as text, including newlines and emoji", () => {
    const hex = utf8ToHex("Grüß\n🌤");
    expect(decodePayload(hex)).toEqual({ text: "Grüß\n🌤", byteLength: new TextEncoder().encode("Grüß\n🌤").length });
  });

  it("shows an empty payload as empty text", () => {
    expect(decodePayload("")).toEqual({ text: "", byteLength: 0 });
  });

  it("keeps binary and control bytes on the hex path", () => {
    expect(decodePayload("00ff")?.text).toBeNull();
    expect(decodePayload("686900")?.text).toBeNull();
    expect(decodePayload("fffe")).toEqual({ text: null, byteLength: 2 });
    expect(isReadableText("ok\u0001")).toBe(false);
  });

  it("rejects odd or non-hex payloads", () => {
    expect(decodePayload("abc")).toBeNull();
    expect(decodePayload("zz")).toBeNull();
  });
});

describe("payloadForSend", () => {
  it("hex-encodes text so capd send cannot misread it as hex", () => {
    expect(payloadForSend("hi", false)).toEqual({ ok: true, param: "6869", byteLength: 2 });
    expect(payloadForSend("cafe", false)).toEqual({ ok: true, param: "63616665", byteLength: 4 });
  });

  it("sends explicit hex unchanged and rejects malformed hex", () => {
    expect(payloadForSend("CA FE", true)).toEqual({ ok: true, param: "cafe", byteLength: 2 });
    expect(payloadForSend("abc", true).ok).toBe(false);
    expect(payloadForSend("   ", false).ok).toBe(false);
  });
});

describe("isMessageHash", () => {
  it("requires 64 hex characters", () => {
    expect(isMessageHash("aa".repeat(32))).toBe(true);
    expect(isMessageHash("AA".repeat(32))).toBe(true);
    expect(isMessageHash("aa".repeat(31))).toBe(false);
  });
});
