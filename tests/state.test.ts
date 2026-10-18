import { describe, expect, test, vi } from "vitest";

import { SessionStateStore, type JarvisStorage } from "../src/state.js";

class MemoryStorage implements JarvisStorage {
  readonly values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async set(key: string, value: boolean): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("SessionStateStore", () => {
  test("defaults a missing session state to disabled", async () => {
    const state = new SessionStateStore(new MemoryStorage());

    await expect(state.isEnabled("session-a")).resolves.toBe(false);
  });

  test("persists enabled and removes disabled state", async () => {
    const storage = new MemoryStorage();
    const set = vi.spyOn(storage, "set");
    const remove = vi.spyOn(storage, "remove");
    const state = new SessionStateStore(storage);

    await expect(state.setEnabled("session-a", true)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith("session/session-a/enabled", true);
    await expect(state.isEnabled("session-a")).resolves.toBe(true);

    await expect(state.setEnabled("session-a", false)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledWith("session/session-a/enabled");
    await expect(state.isEnabled("session-a")).resolves.toBe(false);
  });

  test("toggles a session on and then off", async () => {
    const state = new SessionStateStore(new MemoryStorage());

    await expect(state.toggle("session-a")).resolves.toBe(true);
    await expect(state.toggle("session-a")).resolves.toBe(false);
    await expect(state.isEnabled("session-a")).resolves.toBe(false);
  });

  test("isolates state by session ID", async () => {
    const state = new SessionStateStore(new MemoryStorage());

    await state.setEnabled("session-a", true);

    await expect(state.isEnabled("session-a")).resolves.toBe(true);
    await expect(state.isEnabled("session-b")).resolves.toBe(false);
  });

  test.each([false, 1, "true", null, {}, []])(
    "fails closed for malformed stored value %j",
    async (value) => {
      const storage = new MemoryStorage();
      storage.values.set("session/session-a/enabled", value);
      const state = new SessionStateStore(storage);

      await expect(state.isEnabled("session-a")).resolves.toBe(false);
    },
  );

  test("serializes concurrent toggles for one session", async () => {
    const state = new SessionStateStore(new MemoryStorage());

    const results = await Promise.all([
      state.toggle("session-a"),
      state.toggle("session-a"),
    ]);

    expect(results).toEqual([true, false]);
    expect(await state.isEnabled("session-a")).toBe(false);
  });

  test("does not let a rejected mutation poison later mutations", async () => {
    const storage = new MemoryStorage();
    const failure = new Error("storage unavailable");
    vi.spyOn(storage, "set").mockRejectedValueOnce(failure);
    const state = new SessionStateStore(storage);

    await expect(state.setEnabled("session-a", true)).rejects.toBe(failure);
    await expect(state.setEnabled("session-a", true)).resolves.toBe(true);
    await expect(state.isEnabled("session-a")).resolves.toBe(true);
  });
});
