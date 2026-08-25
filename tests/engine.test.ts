import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createSystemTransform, JarvisEngine } from "../src/engine.js";
import { JARVIS_SYSTEM_INSTRUCTION } from "../src/prompt.js";
import { SessionStateStore } from "../src/state.js";

describe("Jarvis system transform", () => {
  test("leaves existing system instructions unchanged while disabled", async () => {
    const isEnabled = vi.fn().mockResolvedValue(false);
    const transform = createSystemTransform({ isEnabled });
    const system = ["existing\nbytes", "second instruction"];
    const output = { system };

    await transform({ sessionID: "session-a" }, output);

    expect(output.system).toBe(system);
    expect(output.system).toEqual(["existing\nbytes", "second instruction"]);
  });

  test("appends exactly the Jarvis instruction while enabled", async () => {
    const transform = createSystemTransform({
      isEnabled: vi.fn().mockResolvedValue(true),
    });
    const system = ["existing"];
    const output = { system };

    await transform({ sessionID: "session-a" }, output);

    expect(output.system).toBe(system);
    expect(output.system).toEqual(["existing", JARVIS_SYSTEM_INSTRUCTION]);
  });

  test("creates the system list when enabled output has none", async () => {
    const transform = createSystemTransform({
      isEnabled: vi.fn().mockResolvedValue(true),
    });
    const output: { system?: string[] } = {};

    await transform({ sessionID: "session-a" }, output);

    expect(output.system).toEqual([JARVIS_SYSTEM_INSTRUCTION]);
  });

  test("does not read state or mutate output without a session ID", async () => {
    const isEnabled = vi.fn().mockResolvedValue(true);
    const transform = createSystemTransform({ isEnabled });
    const output: { system?: string[] } = {};

    await transform({}, output);

    expect(isEnabled).not.toHaveBeenCalled();
    expect(output).toEqual({});
  });
});

describe("JarvisEngine", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("uses the OpenCode state path for the system transform", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "opencode-jarvis-engine-"));
    temporaryDirectories.push(stateRoot);
    await new SessionStateStore(stateRoot).setEnabled("session-a", true);
    const getPath = vi.fn().mockResolvedValue({ data: { state: stateRoot } });
    const hooks = await JarvisEngine({
      client: { path: { get: getPath } },
    } as unknown as PluginInput);
    const output = { system: ["existing"] };

    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "session-a" } as Parameters<
        NonNullable<typeof hooks["experimental.chat.system.transform"]>
      >[0],
      output,
    );

    expect(getPath).toHaveBeenCalledOnce();
    expect(output.system).toEqual(["existing", JARVIS_SYSTEM_INSTRUCTION]);
  });

  test("returns no hooks when OpenCode provides no state path", async () => {
    const getPath = vi.fn().mockResolvedValue({ data: undefined });

    await expect(
      JarvisEngine({
        client: { path: { get: getPath } },
      } as unknown as PluginInput),
    ).resolves.toEqual({});
  });
});
