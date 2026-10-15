import type { Settings, StoredMessage } from "./types";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "./types";

export interface MessageStore {
  getAll(): Promise<StoredMessage[]>;
  putMany(messages: StoredMessage[]): Promise<void>;
  clearAll(): Promise<void>;
}

export function memoryStore(seed: StoredMessage[] = []): MessageStore {
  const messages = new Map<string, StoredMessage>(seed.map((message) => [message.hash, structuredClone(message)]));
  return {
    async getAll() {
      return [...messages.values()].map((message) => structuredClone(message));
    },
    async putMany(next) {
      for (const message of next) messages.set(message.hash, structuredClone(message));
    },
    async clearAll() {
      messages.clear();
    },
  };
}

const DB_NAME = "capd-chat";
const DB_STORE = "messages";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "hash" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed to open"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function indexedDbStore(): MessageStore {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () => (opening ??= openDatabase());
  return {
    async getAll() {
      const database = await db();
      const rows = await requestToPromise(
        database.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll(),
      );
      return rows as StoredMessage[];
    },
    async putMany(messages) {
      if (messages.length === 0) return;
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(DB_STORE, "readwrite");
        const store = tx.objectStore(DB_STORE);
        for (const message of messages) store.put(message);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      });
    },
    async clearAll() {
      const database = await db();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
      });
    },
  };
}

export async function openMessageStore(): Promise<{ store: MessageStore; persistent: boolean }> {
  if (typeof indexedDB === "undefined") return { store: memoryStore(), persistent: false };
  try {
    const store = indexedDbStore();
    await store.getAll();
    return { store, persistent: true };
  } catch {
    return { store: memoryStore(), persistent: false };
  }
}

export function loadSettings(storage: Storage | null = safeLocalStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const preset = parsed.preset === "nexa" || parsed.preset === "custom" || parsed.preset === "demo" ? parsed.preset : "demo";
    const active = parsed.active === "server" ? "server" : "demo";
    return {
      preset,
      customUrl: typeof parsed.customUrl === "string" ? parsed.customUrl : "",
      active,
      serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
      autoConnect: parsed.autoConnect === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: Storage | null = safeLocalStorage()): void {
  storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
