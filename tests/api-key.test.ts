import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveFishApiKey } from "../src/api-key.js";

describe("Fish API key lookup", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "jarvis-key-test-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("prefers a nonblank process environment key over .env", async () => {
    await writeFile(join(directory, ".env"), "FISH_API_KEY=file-placeholder");
    await expect(resolveFishApiKey({ FISH_API_KEY: " env-placeholder " }, directory))
      .resolves.toBe("env-placeholder");
  });

  it("reads quoted keys and comments without changing the environment or file", async () => {
    const contents = '# local credentials\nexport FISH_API_KEY=" file-placeholder " # comment\nUNRELATED=do-not-load\n';
    await writeFile(join(directory, ".env"), contents);
    const env = { FISH_API_KEY: " " };

    await expect(resolveFishApiKey(env, directory)).resolves.toBe("file-placeholder");
    expect(env).toEqual({ FISH_API_KEY: " " });
    expect(await readFile(join(directory, ".env"), "utf8")).toBe(contents);
  });

  it("returns no key for absent, blank, or unusable .env files", async () => {
    await expect(resolveFishApiKey({}, directory)).resolves.toBeUndefined();
    await writeFile(join(directory, ".env"), "FISH_API_KEY=   # empty");
    await expect(resolveFishApiKey({}, directory)).resolves.toBeUndefined();
    await rm(join(directory, ".env"));
    await mkdir(join(directory, ".env"));
    await expect(resolveFishApiKey({}, directory)).resolves.toBeUndefined();
  });

  it("does not search parent directories", async () => {
    await writeFile(join(directory, ".env"), "FISH_API_KEY=parent-placeholder");
    const child = join(directory, "child");
    await mkdir(child);
    await expect(resolveFishApiKey({}, child)).resolves.toBeUndefined();
  });

  it("does not expand or execute shell expressions", async () => {
    await writeFile(join(directory, ".env"), "FISH_API_KEY='$(printf unsafe)-${HOME}'");
    await expect(resolveFishApiKey({}, directory)).resolves.toBe("$(printf unsafe)-${HOME}");
  });
});
