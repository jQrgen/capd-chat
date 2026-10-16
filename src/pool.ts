import { mapLimit } from "./async";
import { decodePayload, isEvenHex, isMessageHash } from "./decode";
import type { CapdInfo, StoredMessage } from "./types";

export const FETCH_CAP = 200;
export const FETCH_CONCURRENCY = 6;
const NEVER_EXPIRES = 65535;
export const MAX_LIST = 10_000;
export const MAX_STORED = 5_000;
export const MAX_DATA_BYTES = 64 * 1024;
const MIN_CREATED = 1_577_836_800;
const MAX_FUTURE_SEC = 120;

export const messageKey = (message: Pick<StoredMessage, "server" | "hash">): string => `${message.server} ${message.hash}`;

export type CapdRpc = {
  info(): Promise<unknown>;
  list(): Promise<unknown>;
  get(hash: string): Promise<unknown>;
};

export type PullResult = {
  info: CapdInfo;
  messages: StoredMessage[];
  /** Hashes still in the pool that this pull did not fetch. */
  remaining: number;
  /**
   * In-pool hashes missing from a complete snapshot.
   * Null when `capd.list` was truncated, so absence does not mean the message left.
   */
  departed: string[] | null;
  listed: number;
  skipped: number;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function integerNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null || !Number.isInteger(number) || number < 0) return null;
  return number;
}

export function parseCapdInfo(value: unknown): CapdInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const size = integerNumber(record.size);
  const count = integerNumber(record.count);
  const minPriority = finiteNumber(record.minPriority);
  const maxPriority = finiteNumber(record.maxPriority);
  const relayPriority = finiteNumber(record.relayPriority);
  if (
    size === null ||
    count === null ||
    minPriority === null ||
    maxPriority === null ||
    relayPriority === null
  ) {
    return null;
  }
  return { size, count, minPriority, maxPriority, relayPriority };
}

export function parseCapdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const hashes: string[] = [];
  for (const entry of value.slice(-MAX_LIST)) {
    if (typeof entry !== "string" || !isMessageHash(entry)) return null;
    hashes.push(entry.toLowerCase());
  }
  return hashes;
}

export type ParseMessageResult =
  | { ok: true; message: Omit<StoredMessage, "inPool" | "server" | "origin" | "firstSeen" | "lastSeen"> }
  | { ok: false; reason: string };

function hexField(record: Record<string, unknown>, key: string, minChars: number, maxChars: number): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  if (value.length < minChars || value.length > maxChars || !isEvenHex(value)) return null;
  return value.toLowerCase();
}

export function parseCapdMessage(value: unknown, nowSec = Date.now() / 1000): ParseMessageResult {
  if (!value || typeof value !== "object") return { ok: false, reason: "message is not an object" };
  const record = value as Record<string, unknown>;
  if (typeof record.hash !== "string" || !isMessageHash(record.hash)) {
    return { ok: false, reason: "hash is missing" };
  }
  const created = integerNumber(record.created);
  if (created === null) return { ok: false, reason: "created is missing" };
  if (created < MIN_CREATED || created > nowSec + MAX_FUTURE_SEC) return { ok: false, reason: "created is out of range" };
  const difficultyBits = integerNumber(record.difficultyBits);
  if (difficultyBits === null || difficultyBits > 0xffffffff) {
    return { ok: false, reason: "difficultyBits is missing" };
  }
  const priority = finiteNumber(record.priority);
  const initialPriority = finiteNumber(record.initialPriority);
  if (priority === null || initialPriority === null) {
    return { ok: false, reason: "priority is missing" };
  }
  const powTarget = hexField(record, "powTarget", 2, 64);
  const nonce = hexField(record, "nonce", 0, 1024);
  const data = hexField(record, "data", 0, MAX_DATA_BYTES * 2);
  if (!powTarget || nonce === null || data === null) {
    return { ok: false, reason: "hex fields are invalid" };
  }
  const size = integerNumber(record.size);
  if (size === null || size > MAX_DATA_BYTES * 4) return { ok: false, reason: "size is invalid" };

  let expiration: number | undefined;
  if ("expiration" in record && record.expiration !== null && record.expiration !== undefined) {
    const seconds = integerNumber(record.expiration);
    if (seconds === null || seconds > NEVER_EXPIRES) return { ok: false, reason: "expiration is invalid" };
    if (seconds !== NEVER_EXPIRES) expiration = seconds;
  }

  const decoded = decodePayload(data);
  if (!decoded) return { ok: false, reason: "data is not hex" };

  return {
    ok: true,
    message: {
      hash: record.hash.toLowerCase(),
      created,
      ...(expiration !== undefined ? { expiration } : {}),
      difficultyBits,
      priority,
      initialPriority,
      powTarget,
      nonce,
      size,
      data,
      text: decoded.text,
    },
  };
}

export function stampMessage(
  message: Omit<StoredMessage, "inPool" | "server" | "origin" | "firstSeen" | "lastSeen">,
  server: string,
  nowMs: number,
  origin: StoredMessage["origin"] = "network",
): StoredMessage {
  return {
    ...message,
    inPool: true,
    server,
    origin,
    firstSeen: nowMs,
    lastSeen: nowMs,
  };
}

/**
 * `capd.list` is lowest priority first. Unknown hashes are taken from the
 * high-priority end, which is where new messages usually appear.
 */
export function planFetch(
  listLowestToHighest: readonly string[],
  satisfied: ReadonlySet<string>,
  cap: number,
): { fetch: string[]; remaining: number } {
  const unknown: string[] = [];
  for (let i = listLowestToHighest.length - 1; i >= 0; i--) {
    const hash = listLowestToHighest[i];
    if (!satisfied.has(hash)) unknown.push(hash);
  }
  return {
    fetch: unknown.slice(0, Math.max(0, cap)),
    remaining: Math.max(0, unknown.length - Math.max(0, cap)),
  };
}

/** A list shorter than `capd.info`'s count omitted the lowest-priority hashes. */
export function snapshotIsComplete(infoCount: number, listLength: number): boolean {
  return infoCount === listLength;
}

export function departedHashes(
  list: readonly string[],
  inPool: ReadonlySet<string>,
  complete: boolean,
): string[] | null {
  if (!complete) return null;
  const live = new Set(list);
  const departed: string[] = [];
  for (const hash of inPool) {
    if (!live.has(hash)) departed.push(hash);
  }
  return departed;
}

export async function pullPool(
  rpc: CapdRpc,
  server: string,
  satisfied: ReadonlySet<string>,
  inPool: ReadonlySet<string>,
  nowMs: number,
  cap = FETCH_CAP,
): Promise<PullResult> {
  const info = parseCapdInfo(await rpc.info());
  if (!info) throw new Error("capd.info returned an unexpected payload");
  const list = parseCapdList(await rpc.list());
  if (!list) throw new Error("capd.list returned an unexpected payload");

  const plan = planFetch(list, satisfied, cap);
  const fetched = await mapLimit(plan.fetch, FETCH_CONCURRENCY, async (hash) => {
    try {
      return { hash, value: await rpc.get(hash) };
    } catch (error) {
      if (isTransportFailure(error)) throw error;
      return { hash, value: null };
    }
  });

  const messages: StoredMessage[] = [];
  let skipped = 0;
  for (const item of fetched) {
    if (item.value === null) {
      skipped += 1;
      continue;
    }
    const parsed = parseCapdMessage(item.value);
    if (!parsed.ok) {
      skipped += 1;
      continue;
    }
    messages.push(stampMessage(parsed.message, server, nowMs));
  }

  const complete = snapshotIsComplete(info.count, list.length);
  return {
    info,
    messages,
    remaining: plan.remaining,
    departed: departedHashes(list, inPool, complete),
    listed: list.length,
    skipped,
  };
}

function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === "Connection closed" || error.message.startsWith("Timed out");
}

export function mergePulled(
  existing: readonly StoredMessage[],
  pulled: readonly StoredMessage[],
  departed: readonly string[] | null,
  nowMs: number,
  server?: string,
): StoredMessage[] {
  const byKey = new Map(existing.map((message) => [messageKey(message), message]));
  for (const message of pulled) {
    const previous = byKey.get(messageKey(message));
    byKey.set(messageKey(message), {
      ...message,
      origin: previous?.origin ?? message.origin,
      firstSeen: previous?.firstSeen ?? message.firstSeen,
      lastSeen: nowMs,
      inPool: true,
    });
  }
  if (departed) {
    const gone = new Set(departed);
    for (const [key, message] of byKey) {
      if (gone.has(message.hash) && message.inPool && (server === undefined || message.server === server)) {
        byKey.set(key, { ...message, inPool: false, lastSeen: nowMs });
      }
    }
  }
  return [...byKey.values()];
}

/** Keeps at most `max` messages, dropping the longest-unseen ones that left the pool first. */
export function capStored(messages: readonly StoredMessage[], max = MAX_STORED): { kept: StoredMessage[]; dropped: StoredMessage[] } {
  if (messages.length <= max) return { kept: [...messages], dropped: [] };
  const order = [...messages].sort((a, b) => Number(a.inPool) - Number(b.inPool) || a.lastSeen - b.lastSeen);
  const dropped = order.slice(0, messages.length - max);
  const gone = new Set(dropped);
  return { kept: messages.filter((message) => !gone.has(message)), dropped };
}
