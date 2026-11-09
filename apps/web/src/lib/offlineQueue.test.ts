import { describe, expect, it } from "vitest";
import { chunkActions, OFFLINE_BATCH_LIMIT } from "./offlineQueue";

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
});
