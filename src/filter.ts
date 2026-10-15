import type { StoredMessage } from "./types";

export type KindFilter = "all" | "text" | "hex";
export type PresenceFilter = "all" | "pool" | "kept";

export type FeedView = {
  query: string;
  kind: KindFilter;
  presence: PresenceFilter;
  server: string | null;
};

export function compareMessages(a: StoredMessage, b: StoredMessage): number {
  if (a.created !== b.created) return a.created - b.created;
  if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;
  if (a.hash < b.hash) return -1;
  if (a.hash > b.hash) return 1;
  return 0;
}

export function matchesQuery(message: StoredMessage, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const compact = trimmed.replace(/\s+/g, "");
  if (compact && message.hash.includes(compact)) return true;
  if (compact && message.data.includes(compact)) return true;
  if (message.text && message.text.toLowerCase().includes(trimmed)) return true;
  return false;
}

export function matchesView(message: StoredMessage, view: FeedView): boolean {
  if (view.server && message.server !== view.server) return false;
  if (view.kind === "text" && message.text === null) return false;
  if (view.kind === "hex" && message.text !== null) return false;
  if (view.presence === "pool" && !message.inPool) return false;
  if (view.presence === "kept" && message.inPool) return false;
  return matchesQuery(message, view.query);
}

/** Oldest first, so the newest message sits at the bottom of the feed. */
export function visibleMessages(messages: StoredMessage[], view: FeedView): StoredMessage[] {
  return messages.filter((message) => matchesView(message, view)).sort(compareMessages);
}
