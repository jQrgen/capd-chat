export type RpcErrorBody = { code: number; message: string };

export class ElectrumError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "ElectrumError";
    this.code = code;
  }
}

export type ParsedElectrum =
  | { kind: "response"; id: number; result?: unknown; error?: RpcErrorBody }
  | { kind: "notification"; method: string; params: unknown[] };

export type SocketLike = {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
};

export function parseElectrumMessage(value: unknown): ParsedElectrum | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  const hasId = "id" in message && message.id !== null && message.id !== undefined;

  if (!hasId && typeof message.method === "string") {
    return {
      kind: "notification",
      method: message.method,
      params: Array.isArray(message.params) ? message.params : [],
    };
  }

  if (!hasId) return null;
  const id = typeof message.id === "number" ? message.id : Number(message.id);
  if (!Number.isInteger(id)) return null;

  if (message.error && typeof message.error === "object") {
    const body = message.error as Record<string, unknown>;
    return {
      kind: "response",
      id,
      error: {
        code: typeof body.code === "number" ? body.code : -1,
        message: typeof body.message === "string" ? body.message : "RPC error",
      },
    };
  }

  return { kind: "response", id, result: "result" in message ? message.result : null };
}

/** Method missing, including a node that has no CAPD RPC. Both use JSON-RPC -32601. */
export function isMethodMissing(error: unknown): boolean {
  return error instanceof ElectrumError && error.code === -32601;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ElectrumClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(method: string, params: unknown[]) => void>();
  private closed = false;
  private closeHandler: (() => void) | null = null;

  constructor(private readonly socket: SocketLike) {
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      this.onMessage(event.data);
    };
    socket.onclose = () => {
      const remote = !this.closed;
      this.failAll(new Error("Connection closed"));
      if (remote) this.closeHandler?.();
    };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request(method: string, params: unknown[] = [], timeoutMs = 12_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Connection closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onNotification(handler: (method: string, params: unknown[]) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** Fires when the socket closes without `close()` being called. */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      /* already closing */
    }
    this.failAll(new Error("Connection closed"));
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private onMessage(raw: string): void {
    if (raw.length > MAX_RESPONSE_CHARS) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const frames = Array.isArray(parsed) ? parsed : [parsed];
    for (const frame of frames) {
      const message = parseElectrumMessage(frame);
      if (!message) continue;
      if (message.kind === "notification") {
        for (const listener of this.listeners) listener(message.method, message.params);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new ElectrumError(message.error.code, message.error.message));
      else pending.resolve(message.result);
    }
  }
}

export function socketFromWebSocket(ws: WebSocket): SocketLike {
  const sink: SocketLike = {
    send(data) {
      ws.send(data);
    },
    close() {
      ws.close();
    },
    onmessage: null,
    onclose: null,
  };
  ws.onmessage = (event) => sink.onmessage?.({ data: event.data });
  ws.onclose = () => sink.onclose?.();
  return sink;
}

export function openWebSocket(url: string, timeoutMs = 10_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("Timed out opening the WebSocket"));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error("Could not open the WebSocket"));
    });
  });
}

export async function connectElectrum(url: string): Promise<ElectrumClient> {
  const ws = await openWebSocket(url);
  return new ElectrumClient(socketFromWebSocket(ws));
}

export async function negotiateVersion(client: ElectrumClient): Promise<string> {
  const result = await client.request("server.version", ["capd-chat", "1.4"]);
  if (Array.isArray(result) && typeof result[0] === "string") return result[0];
  if (typeof result === "string") return result;
  return "Rostrum";
}

/**
 * Notification params are unspecified: MR !544 does not register `capd.subscribe`.
 * Accept a hash, a list of hashes, or a `capd.get` object wherever they appear.
 */
export const MAX_NOTIFY_HASHES = 50;
export const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

export function hashesFromNotification(params: unknown[]): string[] {
  const hashes: string[] = [];
  const visit = (value: unknown): void => {
    if (hashes.length >= MAX_NOTIFY_HASHES) return;
    if (typeof value === "string") {
      if (/^[0-9a-fA-F]{64}$/.test(value)) hashes.push(value.toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object" && "hash" in value) {
      const hash = (value as { hash?: unknown }).hash;
      if (typeof hash === "string" && /^[0-9a-fA-F]{64}$/.test(hash)) hashes.push(hash.toLowerCase());
    }
  };
  params.forEach(visit);
  return [...new Set(hashes)];
}
