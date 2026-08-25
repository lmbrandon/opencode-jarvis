import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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

  test.each([
    [
      "setEnabled",
      (store: SessionStateStore) => store.setEnabled("session-a", true),
    ],
    ["toggle", (store: SessionStateStore) => store.toggle("session-a")],
  ])(
    "%s rejects operational read errors while reads fail closed",
    async (_method, mutate) => {
      const stateRoot = await createStateRoot();
      const stateDirectory = join(stateRoot, "opencode-jarvis");
      const invalidTarget = join(stateRoot, "invalid-state-target");
      const stateFile = join(stateDirectory, "state.json");
      await mkdir(stateDirectory, { recursive: true });
      await mkdir(invalidTarget);
      await symlink(invalidTarget, stateFile, "dir");
      const store = new SessionStateStore(stateRoot);

      await expect(store.isEnabled("session-a")).resolves.toBe(false);
      await expect(mutate(store)).rejects.toMatchObject({ code: "EISDIR" });
      expect((await lstat(stateFile)).isSymbolicLink()).toBe(true);
    },
  );

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

  test("serializes mutations across store instances", async () => {
    const stateRoot = await createStateRoot();
    const firstStore = new SessionStateStore(stateRoot);
    const secondStore = new SessionStateStore(stateRoot);

    await Promise.all([
      firstStore.setEnabled("session-a", true),
      secondStore.setEnabled("session-b", true),
    ]);

    const reader = new SessionStateStore(stateRoot);
    await expect(
      Promise.all([
        reader.isEnabled("session-a"),
        reader.isEnabled("session-b"),
      ]),
    ).resolves.toEqual([true, true]);
  });

  test("gives up after a bounded wait when the mutation lock stays active", async () => {
    const stateRoot = await createStateRoot();
    const stateDirectory = join(stateRoot, "opencode-jarvis");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, "state.lock"), "active", "utf8");
    const store = new SessionStateStore(stateRoot);

    await expect(store.setEnabled("session-a", true)).rejects.toThrow(
      "Timed out waiting for state lock",
    );
  });

  test("recovers a stale mutation lock", async () => {
    const stateRoot = await createStateRoot();
    const stateDirectory = join(stateRoot, "opencode-jarvis");
    const lockFile = join(stateDirectory, "state.lock");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(lockFile, "abandoned", "utf8");
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockFile, staleTime, staleTime);
    const store = new SessionStateStore(stateRoot);

    await expect(store.setEnabled("session-a", true)).resolves.toBe(true);
    await expect(stat(lockFile)).rejects.toMatchObject({ code: "ENOENT" });
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
