import { bytesToHex, hexToBytes } from "./decode";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) >>> 0));
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

/** Same as `CapdMsg::CalcHash` in nexa, with no rescind hash (Rostrum does not return it). */
export function capdHash(data: Uint8Array, created: number, expiration: number, bits: number, nonce: Uint8Array): string {
  const n = data.length;
  const prefix = n < 0xfd ? [n] : n <= 0xffff ? [0xfd, n & 0xff, n >> 8] : [0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
  const pre = new Uint8Array(prefix.length + n + 8 + 20 + 2 + 4);
  const view = new DataView(pre.buffer);
  pre.set(prefix);
  pre.set(data, prefix.length);
  let at = prefix.length + n;
  view.setUint32(at, created >>> 0, true);
  view.setUint32(at + 4, Math.floor(created / 2 ** 32), true);
  at += 28;
  view.setUint16(at, expiration, true);
  view.setUint32(at + 2, bits >>> 0, true);
  const stage = new Uint8Array(32 + nonce.length);
  stage.set(sha256(pre));
  stage.set(nonce, 32);
  return bytesToHex(sha256(sha256(stage)).reverse());
}

/** nBits as 64 hex digits, like `arith_uint256::SetCompact` (sign bit ignored, overflow dropped). */
export function compactTargetHex(bits: number): string {
  const size = bits >>> 24;
  const word = BigInt(bits & 0x007fffff);
  const value = size <= 3 ? word >> BigInt(8 * (3 - size)) : (word << BigInt(8 * (size - 3))) & ((1n << 256n) - 1n);
  return value.toString(16).padStart(64, "0");
}

/** nexa `Priority(difficultyBits, size, 0)`. */
export function initialPriority(bits: number, size: number): number {
  const target = Number(BigInt("0x" + compactTargetHex(bits)));
  const value = 2 ** 248 / target;
  return size > 100 ? (value / size) * 100 : value;
}

/** Client-side minimum, the node's `MIN_LOCAL_PRIORITY` with an empty pool. */
export const MIN_PRIORITY = 1;

/** `CapdMsg::DoesPowMeetTarget` on the recomputed hash, plus the local priority floor. */
export function verifyWork(hash: string, dataHex: string, created: number, expiration: number, bits: number, nonceHex: string): boolean {
  const data = hexToBytes(dataHex);
  const nonce = hexToBytes(nonceHex);
  if (!data || !nonce || initialPriority(bits, data.length) < MIN_PRIORITY) return false;
  const actual = capdHash(data, created, expiration, bits, nonce);
  return actual === hash && actual < compactTargetHex(bits);
}
