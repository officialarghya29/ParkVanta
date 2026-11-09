import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, api } from "../lib/api";

export interface RealtimeEvent {
  id: string;
  type: string;
  property_id: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

const EVENT_TYPES = [
  "invitation.created",
  "invitation.approved",
  "invitation.rejected",
  "invitation.cancelled",
  "gate.entry_authorized",
  "gate.entry_confirmed",
  "gate.exit_confirmed",
  "gate.manual_override",
  "gate.entry_denied",
  "parking.updated",
  "parking.overstay",
];

/**
 * Subscribes to property-scoped SSE frames. The callback should invalidate
 * queries; the database remains the source of truth when the stream drops.
 */
export function useEventStream(
  propertyId: string | null | undefined,
  onEvent: (event: RealtimeEvent) => void,
): boolean {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  const cursor = useRef<string | null>(null);
  handler.current = onEvent;

  useEffect(() => {
    cursor.current = null;
    setConnected(false);
    if (!propertyId) return;
    let source: EventSource | null = null;
    let reconnect: number | undefined;
    let closed = false;

    async function connect() {
      try {
        const { ticket } = await api<{ ticket: string }>("/events/ticket", {
          method: "POST",
          json: { property_id: propertyId },
        });
        if (closed) return;
        const params = new URLSearchParams({ ticket });
        if (cursor.current) params.set("last_event_id", cursor.current);
        source = new EventSource(`${API_BASE_URL}/events/stream?${params.toString()}`);
        source.onopen = () => setConnected(true);
        source.onerror = () => {
          setConnected(false);
          source?.close();
          source = null;
          if (!closed) reconnect = window.setTimeout(connect, 5000);
        };
        for (const type of EVENT_TYPES) {
          source.addEventListener(type, (event) => {
            const message = event as MessageEvent;
            if (message.lastEventId) cursor.current = message.lastEventId;
            try {
              handler.current(JSON.parse(message.data) as RealtimeEvent);
            } catch {
              // Ignore malformed frames; polling still reconciles state.
            }
          });
        }
      } catch {
        if (!closed) reconnect = window.setTimeout(connect, 8000);
      }
    }

    void connect();
    return () => {
      closed = true;
      if (reconnect) window.clearTimeout(reconnect);
      source?.close();
    };
  }, [propertyId]);

  return connected;
}
