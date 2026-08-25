import { describe, expect, test, vi } from "vitest";

import { GENERAL_GREETING, skillLoadingCue } from "../src/cues.js";
import {
  FISH_FORMAT,
  FISH_MODEL,
  FISH_REFERENCE_ID,
  FishAudioClient,
  FishAudioError,
} from "../src/fish.js";

describe("FishAudioClient", () => {
  test("validates a key through the credit endpoint without synthesizing", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new FishAudioClient(fetcher);

    await expect(client.validateKey("secret-key")).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.fish.audio/wallet/self/api-credit",
      {
        method: "GET",
        headers: { Authorization: "Bearer secret-key" },
      },
    );
  });

  test.each([401, 403])(
    "returns false when the credit endpoint rejects a key with %i",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("unauthorized", { status }));

      await expect(
        new FishAudioClient(fetcher).validateKey("bad-key"),
      ).resolves.toBe(false);
    },
  );

  test.each([429, 500, 503])(
    "throws a sanitized service error when key validation returns %i",
    async (status) => {
      const apiKey = "validation-secret-never-expose";
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(`service unavailable for ${apiKey}`, { status }),
        );

      const error = await new FishAudioClient(fetcher)
        .validateKey(apiKey)
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(FishAudioError);
      expect(error).toMatchObject({ status });
      expect((error as Error).message).not.toContain(apiKey);
    },
  );

  test("sends the exact pinned TTS request and returns binary audio", async () => {
    const audio = new Uint8Array([0, 1, 127, 128, 255]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(audio, { status: 200 }));
    const signal = new AbortController().signal;

    const result = await new FishAudioClient(fetcher).synthesize(
      "secret-key",
      "Hello, sir.",
      signal,
    );

    expect(result).toEqual(audio);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-key",
        "Content-Type": "application/json",
        model: "s2.1-pro-free",
      },
      body: JSON.stringify({
        text: "Hello, sir.",
        reference_id: "14129c3e320149449d6bada6862f7338",
        format: "mp3",
      }),
      signal,
    });
    expect(FISH_MODEL).toBe("s2.1-pro-free");
    expect(FISH_REFERENCE_ID).toBe("14129c3e320149449d6bada6862f7338");
    expect(FISH_FORMAT).toBe("mp3");
  });

  test("bounds and cancels an oversized error body without exposing the API key", async () => {
    const apiKey = "fish-secret-never-expose";
    const encoder = new TextEncoder();
    let pulledChunks = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1;
        if (pulledChunks > 100) {
          controller.close();
          return;
        }
        const prefix = pulledChunks === 1 ? `invalid ${apiKey}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}${"x".repeat(128)}`));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 429 }));

    const error = await new FishAudioClient(fetcher)
      .synthesize(apiKey, "Hello")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FishAudioError);
    expect(error).toMatchObject({ status: 429 });
    expect((error as Error).message.length).toBeLessThanOrEqual(300);
    expect((error as Error).message).not.toContain(apiKey);
    expect(pulledChunks).toBeLessThan(100);
    expect(canceled).toBe(true);
  });
});

describe("cue text", () => {
  test("defines a short nonempty general greeting", () => {
    expect(GENERAL_GREETING.trim().length).toBeGreaterThan(0);
    expect(GENERAL_GREETING.length).toBeLessThanOrEqual(80);
  });

  test.each([
    ["superpowers", "Superpowers"],
    ["test-driven-development", "Test Driven Development"],
    ["  test_driven   development  ", "Test Driven Development"],
  ])("normalizes and title-cases the %s skill", (skill, displayName) => {
    expect(skillLoadingCue(skill)).toBe(
      `Just a second, I'm loading the ${displayName} skill.`,
    );
  });
});
