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

const QUEUE_KEY = "parkvanta.gate.queue.v1";
const CACHE_KEY = "parkvanta.gate.active.v1";
const DEVICE_KEY = "parkvanta.device.id";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function newClientEventId(): string {
  const cryptoApi = window.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  const store = storage();
  const existing = store?.getItem(DEVICE_KEY);
  if (existing) return existing;
  const generated = `gate-${newClientEventId().slice(0, 18)}`;
  store?.setItem(DEVICE_KEY, generated);
  return generated;
}

export function readQueue(): QueuedGateAction[] {
  const raw = storage()?.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueuedGateAction[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            typeof item?.client_event_id === "string" &&
            typeof item?.action === "string" &&
            typeof item?.recorded_at === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeQueue(actions: QueuedGateAction[]): void {
  storage()?.setItem(QUEUE_KEY, JSON.stringify(actions.slice(-100)));
}

export function enqueue(action: QueuedGateAction): void {
  writeQueue([...readQueue(), action]);
}

export function removeQueued(clientEventIds: string[]): void {
  const drop = new Set(clientEventIds);
  writeQueue(readQueue().filter((item) => !drop.has(item.client_event_id)));
}

export function cacheActiveVisitors(visitors: ActiveVisitor[]): void {
  storage()?.setItem(CACHE_KEY, JSON.stringify(visitors));
}

export function readCachedVisitors(): ActiveVisitor[] {
  const raw = storage()?.getItem(CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ActiveVisitor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
