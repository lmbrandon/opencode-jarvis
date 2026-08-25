export const FISH_MODEL = "s2.1-pro-free";
export const FISH_REFERENCE_ID = "14129c3e320149449d6bada6862f7338";
export const FISH_FORMAT = "mp3";

type Fetcher = typeof fetch;

const CREDIT_URL = "https://api.fish.audio/wallet/self/api-credit";
const TTS_URL = "https://api.fish.audio/v1/tts";
const MAX_ERROR_MESSAGE_LENGTH = 300;

export class FishAudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FishAudioError";
  }
}

export class FishAudioClient {
  constructor(private readonly fetcher: Fetcher = fetch) {}

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.fetcher(CREDIT_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(signal ? { signal } : {}),
    });

    return response.ok;
  }

  async synthesize(
    apiKey: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.fetcher(TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: FISH_MODEL,
      },
      body: JSON.stringify({
        text,
        reference_id: FISH_REFERENCE_ID,
        format: FISH_FORMAT,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const detail = await response
        .text()
        .catch(() => "Fish Audio returned an unreadable error response");
      const redacted = apiKey ? detail.split(apiKey).join("[redacted]") : detail;
      const safeDetail = redacted.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
      const message = `Fish Audio request failed (${response.status})${
        safeDetail ? `: ${safeDetail}` : ""
      }`.slice(0, MAX_ERROR_MESSAGE_LENGTH);
      throw new FishAudioError(response.status, message);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}
