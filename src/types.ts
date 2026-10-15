/** A CAPD message kept in the browser, including fields Rostrum's `capd.get` returns. */
export type StoredMessage = {
  hash: string;
  /** Unix seconds. */
  created: number;
  /**
   * Seconds after `created`. Omitted when the message does not expire.
   * Rostrum drops the node's `65535` ("never") sentinel.
   */
  expiration?: number;
  /** Proof-of-work target in Bitcoin nBits form. */
  difficultyBits: number;
  /** Priority reported by the node when the message was fetched. */
  priority: number;
  initialPriority: number;
  powTarget: string;
  nonce: string;
  /** Approximate RAM size reported by the node. */
  size: number;
  /** Payload as lowercase hex. */
  data: string;
  /** Printable UTF-8, or null when the payload is shown as hex. */
  text: string | null;
  inPool: boolean;
  /** Normalized WebSocket URL, or `"demo"`. */
  server: string;
  origin: "network" | "local";
  firstSeen: number;
  lastSeen: number;
};

export type CapdInfo = {
  size: number;
  count: number;
  minPriority: number;
  maxPriority: number;
  relayPriority: number;
};

export type ServerPreset = "demo" | "nexa" | "custom";

export type Settings = {
  preset: ServerPreset;
  customUrl: string;
  active: "demo" | "server";
  serverUrl: string;
  /** Reopen the last server after a reload. Disconnect turns this off. */
  autoConnect: boolean;
};

export const DEMO_SERVER = "demo";

export const NEXA_ROSTRUM = "wss://electrum.nexa.org:20004";

export const SETTINGS_KEY = "capd-chat.settings";

export const DEFAULT_SETTINGS: Settings = {
  preset: "demo",
  customUrl: "",
  active: "demo",
  serverUrl: "",
  autoConnect: false,
};
