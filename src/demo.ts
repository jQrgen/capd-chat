import { bytesToHex, decodePayload } from "./decode";
import type { CapdInfo, StoredMessage } from "./types";
import { DEMO_SERVER } from "./types";

type SeedSpec = {
  nibble: number;
  ageSec: number;
  text?: string;
  bytes?: number[];
  priority: number;
  initialPriority: number;
  difficultyBits: number;
  expiration?: number;
  inPool: boolean;
  nonce: string;
};

const SEED: SeedSpec[] = [
  {
    nibble: 0x14,
    ageSec: 38 * 60,
    text: "nexa:hello. The pool is how counterparties find each other without a directory.",
    priority: 0.42,
    initialPriority: 3.1,
    difficultyBits: 0x1d00ffff,
    inPool: true,
    nonce: "04",
  },
  {
    nibble: 0x2a,
    ageSec: 31 * 60,
    text: "swap BTC/NEX 0.015 @ 1,240,000 NEX. Reply in a message prefixed with the last 16 bytes of this hash.",
    priority: 0.88,
    initialPriority: 4.4,
    difficultyBits: 0x1cffffff,
    inPool: true,
    nonce: "a01f",
  },
  {
    nibble: 0x3c,
    ageSec: 24 * 60,
    bytes: [0x01, 0x00, 0xff, 0xfe, 0x10, 0x22, 0x7f, 0x00, 0x9a, 0x44, 0x11, 0x02],
    priority: 1.15,
    initialPriority: 2.6,
    difficultyBits: 0x1d0186a0,
    inPool: true,
    nonce: "0102",
  },
  {
    nibble: 0x48,
    ageSec: 16 * 60,
    text: "protocol: capd-chat/1\nArchiving locally, so this note is still here after the pool drops it.",
    priority: 1.7,
    initialPriority: 2.9,
    difficultyBits: 0x1d00ffff,
    expiration: 3600,
    inPool: true,
    nonce: "7e",
  },
  {
    nibble: 0x5b,
    ageSec: 12 * 60,
    text: "Filled. Please stop matching the 0.015 BTC offer.",
    priority: 0,
    initialPriority: 1.8,
    difficultyBits: 0x1e0fffff,
    expiration: 120,
    inPool: false,
    nonce: "00ab",
  },
  {
    nibble: 0x6d,
    ageSec: 7 * 60,
    text: "Grüß vom Pool — UTF-8 stays readable when the payload is text.",
    priority: 2.35,
    initialPriority: 2.7,
    difficultyBits: 0x1d00ffff,
    inPool: true,
    nonce: "11",
  },
  {
    nibble: 0x71,
    ageSec: 3 * 60,
    text: "Looking for a group-token indexer. First 2 payload bytes are the protocol id 0xC4 0x01.",
    priority: 3.05,
    initialPriority: 3.2,
    difficultyBits: 0x1c7fffff,
    inPool: true,
    nonce: "be01",
  },
  {
    nibble: 0x8e,
    ageSec: 35,
    bytes: [0xc4, 0x01, 0x00, 0x10, 0xaa, 0xbb, 0x0d, 0x0a, 0xff],
    priority: 4.6,
    initialPriority: 4.6,
    difficultyBits: 0x1c00ffff,
    inPool: true,
    nonce: "0001ff",
  },
];

const LIVE_LINES = [
  "peer: still listening on the demo pool",
  "new offer NEX/USDT 0.00012, good for a few minutes",
  "capd-chat demo: a message can leave the pool and stay in this browser",
  "anyone seen a higher relay priority in the last hour?",
  "protocol: capd-chat/1 ping",
];

function hashFor(nibble: number): string {
  return (nibble & 0xff).toString(16).padStart(2, "0").repeat(32);
}

function liveHash(sequence: number): string {
  const serial = (sequence + 1).toString(16).padStart(8, "0");
  return `${serial}${"ab".repeat(28)}`.slice(0, 64);
}

function finish(
  spec: {
    hash: string;
    created: number;
    text?: string;
    bytes?: number[];
    priority: number;
    initialPriority: number;
    difficultyBits: number;
    expiration?: number;
    inPool: boolean;
    nonce: string;
    origin?: StoredMessage["origin"];
  },
  nowMs: number,
): StoredMessage {
  const data = spec.bytes
    ? bytesToHex(Uint8Array.from(spec.bytes))
    : bytesToHex(new TextEncoder().encode(spec.text ?? ""));
  const decoded = decodePayload(data);
  return {
    hash: spec.hash,
    created: spec.created,
    ...(spec.expiration !== undefined ? { expiration: spec.expiration } : {}),
    difficultyBits: spec.difficultyBits,
    priority: spec.priority,
    initialPriority: spec.initialPriority,
    powTarget: "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    nonce: spec.nonce,
    size: (decoded?.byteLength ?? 0) + 96,
    data,
    text: decoded?.text ?? null,
    inPool: spec.inPool,
    server: DEMO_SERVER,
    origin: spec.origin ?? "network",
    firstSeen: nowMs - Math.max(0, (Math.floor(nowMs / 1000) - spec.created) * 1000),
    lastSeen: nowMs,
  };
}

export function demoSeed(nowMs: number): StoredMessage[] {
  const nowSec = Math.floor(nowMs / 1000);
  return SEED.map((spec) =>
    finish(
      {
        hash: hashFor(spec.nibble),
        created: nowSec - spec.ageSec,
        text: spec.text,
        bytes: spec.bytes,
        priority: spec.priority,
        initialPriority: spec.initialPriority,
        difficultyBits: spec.difficultyBits,
        expiration: spec.expiration,
        inPool: spec.inPool,
        nonce: spec.nonce,
      },
      nowMs,
    ),
  );
}

export function demoInfo(messages: readonly StoredMessage[]): CapdInfo {
  const live = messages.filter((message) => message.server === DEMO_SERVER && message.inPool);
  const priorities = live.map((message) => message.priority);
  const size = live.reduce((sum, message) => sum + message.size, 0);
  return {
    size,
    count: live.length,
    minPriority: priorities.length ? Math.min(...priorities) : 0,
    maxPriority: priorities.length ? Math.max(...priorities) : 0,
    relayPriority: 1,
  };
}

export function nextDemoMessage(sequence: number, nowMs: number): StoredMessage {
  const nowSec = Math.floor(nowMs / 1000);
  const binary = sequence % 5 === 4;
  const text = binary ? undefined : `${LIVE_LINES[sequence % LIVE_LINES.length]} (#${sequence + 1})`;
  const bytes = binary ? [0x01, sequence & 0xff, 0x00, 0xff, 0x7f, 0x10] : undefined;
  return finish(
    {
      hash: liveHash(sequence),
      created: nowSec,
      text,
      bytes,
      priority: 1.4 + (sequence % 5) * 0.35,
      initialPriority: 1.4 + (sequence % 5) * 0.35,
      difficultyBits: 0x1d00ffff,
      expiration: sequence % 4 === 0 ? 600 : undefined,
      inPool: true,
      nonce: (sequence & 0xff).toString(16).padStart(2, "0"),
    },
    nowMs,
  );
}

export function localDemoMessage(asHexPayload: string, nowMs: number): StoredMessage {
  const decoded = decodePayload(asHexPayload);
  const nowSec = Math.floor(nowMs / 1000);
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  return {
    hash: bytesToHex(entropy),
    created: nowSec,
    difficultyBits: 0x1d00ffff,
    priority: 1,
    initialPriority: 1,
    powTarget: "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    nonce: "00",
    size: (decoded?.byteLength ?? 0) + 96,
    data: asHexPayload.toLowerCase(),
    text: decoded?.text ?? null,
    inPool: true,
    server: DEMO_SERVER,
    origin: "local",
    firstSeen: nowMs,
    lastSeen: nowMs,
  };
}
