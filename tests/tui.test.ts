import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  controller: {
    toggle: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    replyCompleted: vi.fn(async () => undefined),
    skillActivated: vi.fn(async () => undefined),
  },
  createController: vi.fn(),
  voice: {
    speakCue: vi.fn(),
    speakReply: vi.fn(),
    cancelSession: vi.fn(),
    dispose: vi.fn(async () => undefined),
  },
  voiceConstructor: vi.fn(),
  fish: { validateKey: vi.fn(async () => true) },
}));

vi.mock("../src/controller.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/controller.js")>();
  return {
    ...original,
    createJarvisController: mocks.createController.mockReturnValue(
      mocks.controller,
    ),
  };
});
vi.mock("../src/voice.js", () => ({
  VoiceService: mocks.voiceConstructor.mockImplementation(function () {
    return mocks.voice;
  }),
}));
vi.mock("../src/fish.js", () => ({
  FishAudioClient: vi.fn(function () { return mocks.fish; }),
}));

import plugin, { setupJarvisTui } from "../src/tui.js";

const location = { directory: "/workspace", workspaceID: "workspace-1" };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createContext() {
  let route: { type: "home" } | { type: "session"; sessionID: string } = {
    type: "home",
  };
  const handlers = new Map<string, (event: any) => void>();
  const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
  const rpc = {
    status: vi.fn(async () => ({ enabled: false })),
    set: vi.fn(async ({ enabled }: { enabled: boolean }) => ({ enabled })),
    toggle: vi.fn(async () => ({ enabled: true })),
  };
  const messages = vi.fn(() => [] as any[]);
  const sessionGet = vi.fn((sessionID: string): {
    id: string;
    location: typeof location;
  } | undefined => ({
    id: sessionID,
    location,
  }));
  const layer = vi.fn();
  const toast = vi.fn();
  const prompt = vi.fn(async (): Promise<string | undefined> => undefined);
  const context = {
    location,
    client: { rpc: vi.fn(() => rpc) },
    data: {
      on: vi.fn((type: string, handler: (event: any) => void) => {
        handlers.set(type, handler);
        const unsubscribe = vi.fn();
        unsubscribers.push(unsubscribe);
        return unsubscribe;
      }),
      location: { default: () => location },
      session: {
        get: sessionGet,
        message: { sync: vi.fn(async (): Promise<void> => undefined), list: messages },
      },
    },
    keymap: { layer },
    ui: {
      router: { current: vi.fn(() => route) },
      dialog: { prompt, clear: vi.fn() },
      toast: { show: toast },
    },
  };
  return {
    context,
    rpc,
    handlers,
    unsubscribers,
    layer,
    toast,
    prompt,
    messages,
    sessionGet,
    setRoute(next: typeof route) {
      route = next;
    },
  };
}

describe("OpenCode 2 TUI plugin", () => {
  const originalKey = process.env.FISH_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalKey;
    vi.clearAllMocks();
    mocks.createController.mockReturnValue(mocks.controller);
    mocks.voiceConstructor.mockImplementation(function () { return mocks.voice; });
    mocks.fish.validateKey.mockResolvedValue(true);
  });

  it("exports a native TUI plugin and registers v2 commands", async () => {
    process.env.FISH_API_KEY = "secret";
    const host = createContext();

    const cleanup = await setupJarvisTui(host.context as never);

    expect(plugin).toMatchObject({ id: "opencode-jarvis.tui" });
    expect(host.layer).toHaveBeenCalledOnce();
    const definition = host.layer.mock.calls[0]![0]();
    expect(definition.mode).toBe("global");
    expect(definition.commands.map((command: any) => command.id)).toEqual([
      "jarvis.toggle",
      "jarvis.enable",
      "jarvis.disable",
      "jarvis.status",
    ]);
    expect(definition.commands[0]).toMatchObject({
      palette: true,
      group: "Jarvis",
      slash: { name: "jarvis" },
    });
    await cleanup?.();
  });

  it("routes mode RPC through the active session location", async () => {
    process.env.FISH_API_KEY = "secret";
    const host = createContext();
    host.setRoute({ type: "session", sessionID: "session-a" });

    const cleanup = await setupJarvisTui(host.context as never);
    const input = mocks.createController.mock.calls[0]![0];
    const session = input.getSession();
    await input.state.toggle(session);
    await input.state.setEnabled(session, false);
    await input.state.isEnabled(session);

    expect(host.rpc.toggle).toHaveBeenCalledWith(
      { sessionID: "session-a" },
      expect.objectContaining({ location, signal: expect.any(AbortSignal) }),
    );
    expect(host.rpc.set).toHaveBeenCalledWith(
      { sessionID: "session-a", enabled: false },
      expect.objectContaining({ location, signal: expect.any(AbortSignal) }),
    );
    expect(host.rpc.status).toHaveBeenCalledWith(
      { sessionID: "session-a" },
      expect.objectContaining({ location, signal: expect.any(AbortSignal) }),
    );
    await cleanup?.();
  });

  it("normalizes successful executions and skill activations", async () => {
    process.env.FISH_API_KEY = "secret";
    const host = createContext();
    host.messages.mockReturnValue([
      { type: "user", id: "user-1", text: "Question" },
      {
        type: "assistant",
        id: "assistant-1",
        time: { completed: new Date() },
        content: [
          { type: "reasoning", text: "private" },
          { type: "text", text: "Ready" },
          { type: "text", text: "sir" },
        ],
      },
    ]);
    const cleanup = await setupJarvisTui(host.context as never);

    await host.handlers.get("session.execution.succeeded")?.({
      id: "execution-event",
      type: "session.execution.succeeded",
      location,
      data: { sessionID: "session-a" },
    });
    await host.handlers.get("session.skill.activated")?.({
      id: "skill-event",
      type: "session.skill.activated",
      location,
      data: {
        sessionID: "session-a",
        id: "brainstorming",
        name: "brainstorming",
        text: "...",
      },
    });

    expect(mocks.controller.replyCompleted).toHaveBeenCalledWith(
      { id: "session-a", location },
      "assistant-1",
      "Ready\nsir",
    );
    expect(mocks.controller.skillActivated).toHaveBeenCalledWith(
      { id: "session-a", location },
      "skill-event",
      "brainstorming",
    );
    await cleanup?.();
  });

  it("uses cached event locations and fails closed when none is known", async () => {
    process.env.FISH_API_KEY = "secret";
    const host = createContext();
    const cachedLocation = {
      directory: "/cached/workspace",
      workspaceID: "cached-workspace",
    };
    host.sessionGet.mockReturnValue({
      id: "session-a",
      location: cachedLocation,
    });
    const cleanup = await setupJarvisTui(host.context as never);

    host.handlers.get("session.skill.activated")?.({
      id: "cached-event",
      type: "session.skill.activated",
      data: {
        sessionID: "session-a",
        id: "brainstorming",
        name: "brainstorming",
        text: "...",
      },
    });
    await vi.waitFor(() => {
      expect(mocks.controller.skillActivated).toHaveBeenCalledWith(
        { id: "session-a", location: cachedLocation },
        "cached-event",
        "brainstorming",
      );
    });

    mocks.controller.skillActivated.mockClear();
    host.sessionGet.mockReturnValue(undefined);
    host.handlers.get("session.skill.activated")?.({
      id: "unresolved-event",
      type: "session.skill.activated",
      data: {
        sessionID: "session-missing",
        id: "brainstorming",
        name: "brainstorming",
        text: "...",
      },
    });
    await Promise.resolve();

    expect(mocks.controller.skillActivated).not.toHaveBeenCalled();
    await cleanup?.();
  });

  it("awaits in-flight events and cleans up idempotently", async () => {
    process.env.FISH_API_KEY = "secret";
    const host = createContext();
    const sync = deferred<void>();
    host.context.data.session.message.sync.mockReturnValue(sync.promise);
    const cleanup = await setupJarvisTui(host.context as never);

    host.handlers.get("session.execution.succeeded")?.({
      id: "execution-event",
      type: "session.execution.succeeded",
      location,
      data: { sessionID: "session-a" },
    });
    let cleaned = false;
    const firstCleanup = cleanup?.().then(() => {
      cleaned = true;
    });
    await Promise.resolve();

    expect(cleaned).toBe(false);
    sync.resolve();
    await firstCleanup;
    await cleanup?.();

    expect(host.unsubscribers).toHaveLength(2);
    expect(host.unsubscribers.every((unsubscribe) =>
      unsubscribe.mock.calls.length === 1,
    )).toBe(true);
    expect(mocks.voice.dispose).toHaveBeenCalledOnce();
    expect(mocks.controller.replyCompleted).not.toHaveBeenCalled();
  });

  it("uses the launch folder .env key without opening a dialog", async () => {
    delete process.env.FISH_API_KEY;
    const directory = await mkdtemp(join(tmpdir(), "jarvis-tui-key-"));
    await writeFile(join(directory, ".env"), "FISH_API_KEY=file-placeholder");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    const host = createContext();
    try {
      const cleanup = await setupJarvisTui(host.context as never);
      const options = mocks.voiceConstructor.mock.calls[0]![0];
      expect(options.getApiKey()).toBe("file-placeholder");
      expect(host.prompt).not.toHaveBeenCalled();
      expect(process.env.FISH_API_KEY).toBeUndefined();
      await cleanup?.();
    } finally {
      cwd.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("clears an owned key prompt and awaits startup during cleanup", async () => {
    delete process.env.FISH_API_KEY;
    const host = createContext();
    const prompt = deferred<string | undefined>();
    host.prompt.mockReturnValue(prompt.promise);
    host.context.ui.dialog.clear.mockImplementation(() => {
      prompt.resolve(undefined);
    });

    const cleanup = await setupJarvisTui(host.context as never);
    await cleanup?.();
    await cleanup?.();

    expect(host.prompt).toHaveBeenCalledOnce();
    expect(host.context.ui.dialog.clear).toHaveBeenCalledOnce();
    expect(mocks.fish.validateKey).not.toHaveBeenCalled();
    expect(mocks.voice.dispose).toHaveBeenCalledOnce();
  });

  it("redacts prompted keys and Fish response details from errors", async () => {
    delete process.env.FISH_API_KEY;
    const host = createContext();
    host.prompt.mockResolvedValue("top-secret");
    const error = Object.assign(
      new Error("top-secret\nprivate response body"),
      { name: "FishAudioError", status: 401 },
    );
    mocks.fish.validateKey.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const cleanup = await setupJarvisTui(host.context as never);
    await vi.waitFor(() => {
      expect(host.toast).toHaveBeenCalledWith({
        title: "Jarvis",
        message: "Fish Audio request failed (401)",
        variant: "error",
      });
    });

    const displayed = JSON.stringify(host.toast.mock.calls);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(displayed).not.toContain("top-secret");
    expect(displayed).not.toContain("private response body");
    expect(logged).not.toContain("top-secret");
    expect(logged).not.toContain("private response body");
    await cleanup?.();
    consoleError.mockRestore();
  });
});
