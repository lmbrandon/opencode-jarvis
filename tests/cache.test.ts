import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { AudioCache, audioCacheKey } from "../src/cache.js";
import {
  FISH_FORMAT,
  FISH_MODEL,
  FISH_REFERENCE_ID,
} from "../src/fish.js";

describe("audioCacheKey", () => {
  test("is the deterministic SHA-256 of text and pinned synthesis settings", () => {
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          text: "hello",
          model: FISH_MODEL,
          reference: FISH_REFERENCE_ID,
          format: FISH_FORMAT,
        }),
      )
      .digest("hex");

    expect(audioCacheKey("hello")).toBe(expected);
    expect(audioCacheKey("hello")).toBe(audioCacheKey("hello"));
    expect(audioCacheKey("hello")).not.toBe(audioCacheKey("Hello"));
  });
});

describe("AudioCache", () => {
  const temporaryDirectories: string[] = [];

  async function createCache(): Promise<{ cache: AudioCache; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "opencode-jarvis-cache-"));
    temporaryDirectories.push(root);
    return { cache: new AudioCache(join(root, "audio")), root };
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("returns an existing MP3 without rendering it again", async () => {
    const { cache } = await createCache();
    const render = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    const first = await cache.getOrCreate("hello", render);
    const second = await cache.getOrCreate("hello", render);

    expect(second).toBe(first);
    expect(first).toMatch(new RegExp(`${audioCacheKey("hello")}\\.mp3$`));
    await expect(readFile(first)).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect((await stat(first)).mode & 0o777).toBe(0o600);
    expect(render).toHaveBeenCalledOnce();
  });

  test("deduplicates concurrent cache misses", async () => {
    const { cache } = await createCache();
    let releaseRender: ((audio: Uint8Array) => void) | undefined;
    const render = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          releaseRender = resolve;
        }),
    );

    const first = cache.getOrCreate("hello", render);
    const second = cache.getOrCreate("hello", render);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    releaseRender?.(new Uint8Array([4, 5, 6]));

    await expect(Promise.all([first, second])).resolves.toEqual([
      await first,
      await first,
    ]);
    expect(render).toHaveBeenCalledOnce();
  });

  test("clears pending work after failure so a later call can retry", async () => {
    const { cache, root } = await createCache();
    const failure = new Error("render failed");
    const render = vi
      .fn<() => Promise<Uint8Array>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(new Uint8Array([7, 8, 9]));

    await expect(cache.getOrCreate("retry", render)).rejects.toBe(failure);
    const file = await cache.getOrCreate("retry", render);

    await expect(readFile(file)).resolves.toEqual(Buffer.from([7, 8, 9]));
    expect(render).toHaveBeenCalledTimes(2);
    expect(await readdir(root)).toEqual(["audio"]);
    expect(await readdir(join(root, "audio"))).toEqual([
      `${audioCacheKey("retry")}.mp3`,
    ]);
  });
});
