export const FISH_MODEL = "s2.1-pro-free";
export const FISH_REFERENCE_ID = "14129c3e320149449d6bada6862f7338";
export const FISH_FORMAT = "mp3";

type Fetcher = typeof fetch;

const CREDIT_URL = "https://api.fish.audio/wallet/self/api-credit";
const TTS_URL = "https://api.fish.audio/v1/tts";
const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_ERROR_BODY_BYTES = 1_200;

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

    if (response.ok) return true;
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }

    throw await fishAudioError(response, apiKey);
  }

  async synthesize(
    apiKey: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.requestTts(apiKey, text, signal);
    return new Uint8Array(await response.arrayBuffer());
  }

  async synthesizeStream(
    apiKey: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.requestTts(apiKey, text, signal);
    if (!response.body) {
      throw new Error("Fish Audio response had no body to stream");
    }
    return response.body;
  }

  private async requestTts(
    apiKey: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<Response> {
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
      throw await fishAudioError(response, apiKey);
    }

    return response;
  }
}

async function fishAudioError(
  response: Response,
  apiKey: string,
): Promise<FishAudioError> {
  const detail = await readBoundedErrorBody(response, apiKey);
  const safeDetail = detail.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  const message = `Fish Audio request failed (${response.status})${
    safeDetail ? `: ${safeDetail}` : ""
  }`.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return new FishAudioError(response.status, message);
}

async function readBoundedErrorBody(
  response: Response,
  apiKey: string,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (byteLength < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = MAX_ERROR_BODY_BYTES - byteLength;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    }
  } catch {
    return "Fish Audio returned an unreadable error response";
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const detail = new TextDecoder().decode(bytes);
  return apiKey ? detail.split(apiKey).join("[redacted]") : detail;
}
