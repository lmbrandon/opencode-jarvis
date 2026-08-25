import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { SessionStateStore } from "../src/state.js";

describe("SessionStateStore", () => {
  const temporaryDirectories: string[] = [];

  async function createStateRoot(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "opencode-jarvis-state-"));
    temporaryDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("defaults a missing session state to off", async () => {
    const store = new SessionStateStore(await createStateRoot());

    await expect(store.isEnabled("session-a")).resolves.toBe(false);
  });

  test("toggles only the selected session", async () => {
    const store = new SessionStateStore(await createStateRoot());

    await expect(store.toggle("session-a")).resolves.toBe(true);
    await expect(store.isEnabled("session-a")).resolves.toBe(true);
    await expect(store.isEnabled("session-b")).resolves.toBe(false);
    await expect(store.toggle("session-a")).resolves.toBe(false);
    await expect(store.isEnabled("session-a")).resolves.toBe(false);
  });

  test("fails closed when state JSON is corrupt", async () => {
    const stateRoot = await createStateRoot();
    const stateDirectory = join(stateRoot, "opencode-jarvis");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, "state.json"), "{not-json", "utf8");

    const store = new SessionStateStore(stateRoot);

    await expect(store.isEnabled("session-a")).resolves.toBe(false);
  });

  test("serializes rapid mutations and readers wait for pending writes", async () => {
    const stateRoot = await createStateRoot();
    const store = new SessionStateStore(stateRoot);

    const writes = [
      store.setEnabled("session-a", true),
      store.setEnabled("session-b", true),
      store.setEnabled("session-c", true),
    ];

    await expect(store.isEnabled("session-c")).resolves.toBe(true);
    await expect(Promise.all(writes)).resolves.toEqual([true, true, true]);

    const stateFile = join(stateRoot, "opencode-jarvis", "state.json");
    await expect(readFile(stateFile, "utf8")).resolves.toBe(
      JSON.stringify({
        sessions: {
          "session-a": true,
          "session-b": true,
          "session-c": true,
        },
      }),
    );
    expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
    await expect(readdir(join(stateRoot, "opencode-jarvis"))).resolves.toEqual([
      "state.json",
    ]);
  });

  test("preserves only session entries whose value is exactly true", async () => {
    const stateRoot = await createStateRoot();
    const stateDirectory = join(stateRoot, "opencode-jarvis");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      join(stateDirectory, "state.json"),
      JSON.stringify({
        sessions: {
          enabled: true,
          disabled: false,
          truthy: 1,
        },
      }),
      "utf8",
    );
    const store = new SessionStateStore(stateRoot);

    await expect(store.setEnabled("new-session", true)).resolves.toBe(true);

    await expect(
      readFile(join(stateDirectory, "state.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual({
      sessions: {
        enabled: true,
        "new-session": true,
      },
    });
  });
});
