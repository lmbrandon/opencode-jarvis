import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FISH_FORMAT, FISH_MODEL, FISH_REFERENCE_ID } from "./fish.js";

export function audioCacheKey(text: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        text,
        model: FISH_MODEL,
        reference: FISH_REFERENCE_ID,
        format: FISH_FORMAT,
      }),
    )
    .digest("hex");
}

export class AudioCache {
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly directory: string) {}

  async getOrCreate(
    text: string,
    render: () => Promise<Uint8Array>,
  ): Promise<string> {
    const key = audioCacheKey(text);
    const file = join(this.directory, `${key}.mp3`);

    try {
      await access(file);
      return file;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    const pending = this.pending.get(key);
    if (pending) return pending;

    const created = this.create(file, render).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, created);
    return created;
  }

  private async create(
    file: string,
    render: () => Promise<Uint8Array>,
  ): Promise<string> {
    const audio = await render();
    await mkdir(this.directory, { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporary, audio, { mode: 0o600 });
      await rename(temporary, file);
      return file;
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
