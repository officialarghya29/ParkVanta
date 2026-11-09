import type { ActiveVisitor } from "./types";

export type OfflineActionType = "ENTRY_CONFIRM" | "EXIT_CONFIRM" | "MANUAL_OVERRIDE";

export interface QueuedGateAction {
  client_event_id: string;
  action: OfflineActionType;
  invitation_id?: string;
  slot_code?: string;
  plate_number?: string;
  reason?: string;
  direction?: "ENTRY" | "EXIT";
  recorded_at: string;
}

const DB_NAME = "parkvanta.gate.v2";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const CACHE_STORE = "cache";
const META_STORE = "meta";
const LEGACY_QUEUE_KEY = "parkvanta.gate.queue.v1";
const LEGACY_CACHE_KEY = "parkvanta.gate.active.v1";
const DEVICE_KEY = "parkvanta.device.id";

// Mirrors the reconcile request's max_length=50. The queue itself retains up
// to 100 actions so a busy shift is not lost, but each HTTP request is batched.
export const OFFLINE_BATCH_LIMIT = 50;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "client_event_id" });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return requestResult<T[]>(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return requestResult<T | undefined>(
    db.transaction(storeName, "readonly").objectStore(storeName).get(key),
  );
}

async function idbPut(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await requestResult(key === undefined ? store.put(value) : store.put(value, key));
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  await requestResult(db.transaction(storeName, "readwrite").objectStore(storeName).delete(key));
}

function legacyQueue(): QueuedGateAction[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedGateAction[];
    return Array.isArray(parsed) ? parsed.filter(validAction) : [];
  } catch {
    return [];
  }
}

function validAction(item: QueuedGateAction): boolean {
  return (
    typeof item?.client_event_id === "string" &&
    typeof item?.action === "string" &&
    typeof item?.recorded_at === "string"
  );
}

function fallbackWriteQueue(actions: QueuedGateAction[]): boolean {
  try {
    window.localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(actions.slice(-100)));
    return true;
  } catch {
    return false;
  }
}

export function dedupeActions(actions: QueuedGateAction[]): QueuedGateAction[] {
  const unique = new Map<string, QueuedGateAction>();
  for (const action of actions) {
    if (validAction(action)) unique.set(action.client_event_id, action);
  }
  return [...unique.values()];
}

export function chunkActions<T>(
  actions: T[],
  size: number = OFFLINE_BATCH_LIMIT,
): T[][] {
  const chunkSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < actions.length; index += chunkSize) {
    chunks.push(actions.slice(index, index + chunkSize));
  }
  return chunks;
}

export function newClientEventId(): string {
  const cryptoApi = window.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const generated = `gate-${newClientEventId().slice(0, 18)}`;
    window.localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    return "gate-unavailable";
  }
}

export async function readQueue(): Promise<QueuedGateAction[]> {
  try {
    const stored = await idbGetAll<QueuedGateAction>(QUEUE_STORE);
    const migrated = legacyQueue();
    if (migrated.length) {
      for (const action of migrated) await idbPut(QUEUE_STORE, action);
      try {
        window.localStorage.removeItem(LEGACY_QUEUE_KEY);
      } catch {
        // Ignore storage restrictions.
      }
    }
    return dedupeActions([...stored, ...migrated])
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
      .slice(-100);
  } catch {
    return legacyQueue();
  }
}

export async function enqueue(action: QueuedGateAction): Promise<void> {
  const next = [...(await readQueue()), action].slice(-100);
  try {
    await idbPut(QUEUE_STORE, action);
    const stored = await readQueue();
    if (stored.length > 100) {
      for (const old of stored.slice(0, stored.length - 100)) {
        await idbDelete(QUEUE_STORE, old.client_event_id);
      }
    }
  } catch {
    if (!fallbackWriteQueue(next)) {
      throw new Error("Device storage is unavailable");
    }
  }
}

export async function removeQueued(clientEventIds: string[]): Promise<void> {
  const drop = new Set(clientEventIds);
  try {
    for (const id of clientEventIds) await idbDelete(QUEUE_STORE, id);
  } catch {
    fallbackWriteQueue(legacyQueue().filter((item) => !drop.has(item.client_event_id)));
  }
}

export async function cacheActiveVisitors(visitors: ActiveVisitor[]): Promise<void> {
  try {
    await idbPut(CACHE_STORE, visitors, "active");
    try {
      window.localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  } catch {
    try {
      window.localStorage.setItem(LEGACY_CACHE_KEY, JSON.stringify(visitors));
    } catch {
      // Ignore storage restrictions.
    }
  }
}

export async function readCachedVisitors(): Promise<ActiveVisitor[]> {
  try {
    const cached = await idbGet<ActiveVisitor[]>(CACHE_STORE, "active");
    if (Array.isArray(cached)) return cached;
  } catch {
    // Fall through to the legacy cache.
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActiveVisitor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
