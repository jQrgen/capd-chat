const HASH_RE = /^[0-9a-fA-F]{64}$/;
const HEX_RE = /^[0-9a-fA-F]*$/;

export function isMessageHash(value: string): boolean {
  return HASH_RE.test(value);
}

export function isEvenHex(value: string): boolean {
  return value.length % 2 === 0 && HEX_RE.test(value);
}

export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (!isEvenHex(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Valid UTF-8 that can be shown as chat text.
 * C0 controls other than tab and newline stay on the hex path so binary
 * payloads that happen to be legal UTF-8 are not rendered as blank text.
 */
export function isReadableText(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function decodePayload(hex: string): { text: string | null; byteLength: number } | null {
  const bytes = hexToBytes(hex);
  if (!bytes) return null;
  if (bytes.length === 0) return { text: "", byteLength: 0 };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!isReadableText(text)) return { text: null, byteLength: bytes.length };
    return { text, byteLength: bytes.length };
  } catch {
    return { text: null, byteLength: bytes.length };
  }
}

/** Hex encoding of UTF-8 text. `capd send` treats even hex as raw bytes. */
export function utf8ToHex(text: string): string {
  return bytesToHex(new TextEncoder().encode(text));
}

export type SendPayload =
  | { ok: true; param: string; byteLength: number }
  | { ok: false; error: string };

export function payloadForSend(input: string, asHex: boolean): SendPayload {
  if (asHex) {
    const compact = input.replace(/\s+/g, "");
    if (!compact) return { ok: false, error: "Enter hex to send." };
    if (!isEvenHex(compact)) {
      return { ok: false, error: "Hex payloads need an even number of digits, 0-9 and a-f." };
    }
    return { ok: true, param: compact.toLowerCase(), byteLength: compact.length / 2 };
  }
  if (input.trim().length === 0) return { ok: false, error: "Write a message first." };
  const param = utf8ToHex(input);
  return { ok: true, param, byteLength: param.length / 2 };
}
