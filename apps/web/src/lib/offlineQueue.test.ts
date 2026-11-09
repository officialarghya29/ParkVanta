import { describe, expect, it } from "vitest";
import { chunkActions, dedupeActions, OFFLINE_BATCH_LIMIT } from "./offlineQueue";

describe("chunkActions", () => {
  it("splits a full device queue into reconcile-sized batches", () => {
    const actions = Array.from({ length: 101 }, (_, index) => ({ id: index }));
    const batches = chunkActions(actions);

    expect(OFFLINE_BATCH_LIMIT).toBe(50);
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 1]);
    expect(batches.flat()).toEqual(actions);
  });

  it("keeps a single small batch intact", () => {
    const actions = [{ id: 1 }, { id: 2 }];
    expect(chunkActions(actions)).toEqual([actions]);
  });

  it("deduplicates migrated and IndexedDB actions by client event id", () => {
    const first = {
      client_event_id: "offline-exit-1",
      action: "EXIT_CONFIRM" as const,
      recorded_at: "2026-11-10T10:00:00.000Z",
    };
    const replacement = { ...first, recorded_at: "2026-11-10T10:00:01.000Z" };

    const deduped = dedupeActions([first, replacement]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].recorded_at).toBe("2026-11-10T10:00:01.000Z");
  });
});
