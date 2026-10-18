import { describe, expect, test, vi } from "vitest";

import plugin from "../src/index.js";
import { setupJarvisServer } from "../src/engine.js";
import { JARVIS_SYSTEM_INSTRUCTION } from "../src/prompt.js";
import { JarvisRpc } from "../src/rpc.js";

interface RpcContext {
  error(type: string, message: string, data: object): unknown;
}

interface RpcHandlers {
  status(input: unknown, context: RpcContext): Promise<unknown>;
  set(input: unknown, context: RpcContext): Promise<unknown>;
  toggle(input: unknown, context: RpcContext): Promise<unknown>;
}

function createContext() {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  let handlers: RpcHandlers | undefined;
  let contextHook: ((event: { sessionID: string; system: unknown[] }) => Promise<void>) | undefined;
  const rpc = {
    register: vi.fn(async (_definition: unknown, registered: RpcHandlers) => {
      handlers = registered;
      return { dispose: vi.fn(), events: { emit: vi.fn() } };
    }),
  };
  const session = {
    hook: vi.fn(async (_name: string, hook: typeof contextHook) => {
      contextHook = hook;
      return { dispose: vi.fn() };
    }),
  };

  return {
    ctx: { storage, rpc, session },
    storage,
    values,
    rpc,
    session,
    getHandlers: () => handlers,
    getContextHook: () => contextHook,
  };
}

function rpcContext() {
  return {
    error: vi.fn((type: string, message: string, data: object) => ({
      type,
      message,
      data,
    })),
  };
}

describe("setupJarvisServer", () => {
  test("registers one RPC and one context hook", async () => {
    const harness = createContext();

    await setupJarvisServer(harness.ctx as never);

    expect(harness.rpc.register).toHaveBeenCalledOnce();
    expect(harness.rpc.register).toHaveBeenCalledWith(JarvisRpc, expect.any(Object));
    expect(harness.session.hook).toHaveBeenCalledOnce();
    expect(harness.session.hook).toHaveBeenCalledWith("context", expect.any(Function));
  });

  test("leaves structured system parts unchanged while disabled", async () => {
    const harness = createContext();
    await setupJarvisServer(harness.ctx as never);
    const system = [{ type: "text", text: "existing" }];

    await harness.getContextHook()?.({ sessionID: "session-a", system });

    expect(system).toEqual([{ type: "text", text: "existing" }]);
  });

  test("appends the Jarvis system part while enabled", async () => {
    const harness = createContext();
    harness.values.set("session/session-a/enabled", true);
    await setupJarvisServer(harness.ctx as never);
    const system = [{ type: "text", text: "existing" }];

    await harness.getContextHook()?.({ sessionID: "session-a", system });

    expect(system).toEqual([
      { type: "text", text: "existing" },
      { type: "text", text: JARVIS_SYSTEM_INSTRUCTION },
    ]);
  });

  test("fails closed when storage reads fail during prompt construction", async () => {
    const harness = createContext();
    harness.storage.get.mockRejectedValueOnce(new Error("storage offline"));
    await setupJarvisServer(harness.ctx as never);
    const system = [{ type: "text", text: "existing" }];

    await expect(
      harness.getContextHook()?.({ sessionID: "session-a", system }),
    ).resolves.toBeUndefined();
    expect(system).toEqual([{ type: "text", text: "existing" }]);
  });

  test("implements status, set, and toggle RPC methods", async () => {
    const harness = createContext();
    await setupJarvisServer(harness.ctx as never);
    const handlers = harness.getHandlers()!;
    const context = rpcContext();

    await expect(
      handlers.status({ sessionID: "session-a" }, context),
    ).resolves.toEqual({ enabled: false });
    await expect(
      handlers.set({ sessionID: "session-a", enabled: true }, context),
    ).resolves.toEqual({ enabled: true });
    await expect(
      handlers.toggle({ sessionID: "session-a" }, context),
    ).resolves.toEqual({ enabled: false });
  });

  test.each(["status", "set", "toggle"] as const)(
    "maps %s storage failures to storage_error",
    async (method) => {
      const harness = createContext();
      await setupJarvisServer(harness.ctx as never);
      const handlers = harness.getHandlers()!;
      const context = rpcContext();
      if (method === "set") {
        harness.storage.set.mockRejectedValueOnce(new Error("storage offline"));
      } else {
        harness.storage.get.mockRejectedValueOnce(new Error("storage offline"));
      }
      const input =
        method === "set"
          ? { sessionID: "session-a", enabled: true }
          : { sessionID: "session-a" };

      await expect(handlers[method](input, context)).resolves.toEqual({
        type: "storage_error",
        message: "storage offline",
        data: {},
      });
      expect(context.error).toHaveBeenCalledWith(
        "storage_error",
        "storage offline",
        {},
      );
    },
  );
});

describe("server plugin entrypoint", () => {
  test("exports the native OpenCode 2 plugin definition", () => {
    expect(plugin).toMatchObject({
      id: "opencode-jarvis",
      setup: setupJarvisServer,
    });
  });
});
