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

  test("returns false when the credit endpoint rejects a key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));

    await expect(
      new FishAudioClient(fetcher).validateKey("bad-key"),
    ).resolves.toBe(false);
  });

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

  test("throws a typed bounded error without exposing the API key", async () => {
    const apiKey = "fish-secret-never-expose";
    const responseMessage = `invalid ${apiKey}\n${"x".repeat(1_000)}`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(responseMessage, { status: 429 }));

    const error = await new FishAudioClient(fetcher)
      .synthesize(apiKey, "Hello")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FishAudioError);
    expect(error).toMatchObject({ status: 429 });
    expect((error as Error).message.length).toBeLessThanOrEqual(300);
    expect((error as Error).message).not.toContain(apiKey);
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
