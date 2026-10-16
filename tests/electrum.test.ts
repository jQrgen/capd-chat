import { describe, expect, it } from "vitest";
import {
  ElectrumClient,
  ElectrumError,
  hashesFromNotification,
  isMethodMissing,
  parseElectrumMessage,
  type SocketLike,
} from "../src/electrum";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
  receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

const HASH = "ab".repeat(32);

describe("parseElectrumMessage", () => {
  it("reads results, errors, and notifications", () => {
    expect(parseElectrumMessage({ id: 1, result: ["Rostrum 14.0.1", "1.4"] })).toEqual({
      kind: "response",
      id: 1,
      result: ["Rostrum 14.0.1", "1.4"],
    });
    expect(parseElectrumMessage({ id: "2", error: { code: -32601, message: "unknown method capd.info" } })).toMatchObject({
      kind: "response",
      id: 2,
      error: { code: -32601, message: "unknown method capd.info" },
    });
    expect(parseElectrumMessage({ jsonrpc: "2.0", method: "capd.subscribe", params: [HASH] })).toEqual({
      kind: "notification",
      method: "capd.subscribe",
      params: [HASH],
    });
    expect(parseElectrumMessage({ id: null, method: "capd.subscribe", params: [] })?.kind).toBe("notification");
  });
});

describe("ElectrumClient", () => {
  it("matches responses to ids and emits notifications", async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient(socket);
    const notes: unknown[] = [];
    client.onNotification((method, params) => notes.push([method, params]));
    const pending = client.request("capd.info");
    socket.receive({ method: "capd.subscribe", params: [HASH] });
    socket.receive({ id: 1, result: { count: 1 } });
    await expect(pending).resolves.toEqual({ count: 1 });
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ method: "capd.info", id: 1, params: [] });
    expect(notes).toEqual([["capd.subscribe", [HASH]]]);
  });

  it("rejects method-not-found and ignores a remote close after a local close", async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient(socket);
    let remoteCloses = 0;
    client.onClose(() => {
      remoteCloses += 1;
    });
    const pending = client.request("capd.info");
    socket.receive({ id: 1, error: { code: -32601, message: "unknown method capd.info" } });
    await expect(pending).rejects.toBeInstanceOf(ElectrumError);
    await expect(pending).rejects.toMatchObject({ code: -32601 });
    try {
      await pending;
    } catch (error) {
      expect(isMethodMissing(error)).toBe(true);
    }

    client.close();
    expect(remoteCloses).toBe(0);
    expect(client.isClosed).toBe(true);
  });

  it("reports a remote close and rejects the request that was in flight", async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient(socket);
    let remoteCloses = 0;
    client.onClose(() => {
      remoteCloses += 1;
    });
    const pending = client.request("capd.list", [], 1_000);
    socket.close();
    await expect(pending).rejects.toThrow(/Connection closed/);
    expect(remoteCloses).toBe(1);
  });

  it("times out a request that never returns", async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient(socket);
    await expect(client.request("capd.get", [HASH], 30)).rejects.toThrow(/Timed out/);
  });
});

describe("hashesFromNotification", () => {
  it("collects hashes from strings, lists, and message objects", () => {
    expect(hashesFromNotification([HASH, [HASH.toUpperCase()], { hash: HASH, data: "6869" }])).toEqual([HASH]);
    expect(hashesFromNotification(["not-a-hash", { data: "6869" }])).toEqual([]);
  });
});
