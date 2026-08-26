import type {
  AssistantMessage,
  Message,
  Part,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERAL_GREETING, skillLoadingCue } from "../src/cues.js";
import { createJarvisController } from "../src/controller.js";
import { jarvisCommands } from "../src/tui.js";

function createHarness(initialSessionID: string | undefined) {
  let sessionID = initialSessionID;
  const state = {
    isEnabled: vi.fn(async (_sessionID: string) => false),
    setEnabled: vi.fn(async (_sessionID: string, enabled: boolean) => enabled),
    toggle: vi.fn(async () => true),
  };
  const voice = {
    speakCue: vi.fn(),
    speakReply: vi.fn(),
    cancelSession: vi.fn(),
  };
  const toast = vi.fn();
  const getSessionID = vi.fn(() => sessionID);
  const controller = createJarvisController({ state, voice, toast, getSessionID });

  return {
    controller,
    state,
    voice,
    toast,
    getSessionID,
    setSessionID(nextSessionID: string | undefined) {
      sessionID = nextSessionID;
    },
  };
}

function assistantMessage(
  id: string,
  options: { completed?: boolean; error?: AssistantMessage["error"] } = {},
): AssistantMessage {
  return {
    id,
    sessionID: "session-a",
    role: "assistant",
    time: {
      created: 1,
      ...(options.completed ? { completed: 2 } : {}),
    },
    ...(options.error ? { error: options.error } : {}),
    parentID: "user-1",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    agent: "agent",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

function userMessage(id: string): UserMessage {
  return {
    id,
    sessionID: "session-a",
    role: "user",
    time: { created: 1 },
    agent: "agent",
    model: { providerID: "provider", modelID: "model" },
  };
}

function textPart(
  messageID: string,
  text: string,
  options: { ignored?: boolean } = {},
): TextPart {
  return {
    id: `${messageID}-text-${text}`,
    sessionID: "session-a",
    messageID,
    type: "text",
    text,
    ...options,
  };
}

function runningSkillPart(
  callID: string,
  name: unknown,
  sessionID = "session-a",
): ToolPart {
  return {
    id: `${callID}-part`,
    sessionID,
    messageID: "assistant-1",
    type: "tool",
    callID,
    tool: "skill",
    state: {
      status: "running",
      input: { name },
      time: { start: 1 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("createJarvisController", () => {
  it("is exported", () => {
    expect(createJarvisController).toBeTypeOf("function");
  });

  it("returns the command actions and event handlers", () => {
    const controller = createJarvisController({
      state: {
        isEnabled: vi.fn(),
        setEnabled: vi.fn(),
        toggle: vi.fn(),
      },
      voice: {
        speakCue: vi.fn(),
        speakReply: vi.fn(),
        cancelSession: vi.fn(),
      },
      toast: vi.fn(),
      getSessionID: vi.fn(),
    });

    expect(controller).toEqual({
      toggle: expect.any(Function),
      enable: expect.any(Function),
      disable: expect.any(Function),
      status: expect.any(Function),
      sessionIdle: expect.any(Function),
      partUpdated: expect.any(Function),
    });
  });

  it("warns without side effects when toggle has no active session", async () => {
    const { controller, state, voice, toast } = createHarness(undefined);

    await controller.toggle();

    expect(toast).toHaveBeenCalledWith(
      "Open a session before changing Jarvis mode",
      "warning",
    );
    expect(state.toggle).not.toHaveBeenCalled();
    expect(voice.speakCue).not.toHaveBeenCalled();
    expect(voice.cancelSession).not.toHaveBeenCalled();
  });

  it("resolves the active session at invocation and enables with a greeting", async () => {
    const harness = createHarness(undefined);
    harness.setSessionID("session-now-active");

    await harness.controller.toggle();

    expect(harness.getSessionID).toHaveBeenCalledOnce();
    expect(harness.state.toggle).toHaveBeenCalledWith("session-now-active");
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-now-active",
      GENERAL_GREETING,
    );
    expect(harness.toast).toHaveBeenCalledWith("Jarvis is on", "success");
  });

  it("cancels session voice when toggle disables Jarvis", async () => {
    const harness = createHarness("session-a");
    harness.state.toggle.mockResolvedValue(false);

    await harness.controller.toggle();

    expect(harness.voice.cancelSession).toHaveBeenCalledWith("session-a");
    expect(harness.voice.speakCue).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith("Jarvis is off", "success");
  });

  it("warns without side effects when enable has no active session", async () => {
    const harness = createHarness(undefined);

    await harness.controller.enable();

    expect(harness.toast).toHaveBeenCalledWith(
      "Open a session before changing Jarvis mode",
      "warning",
    );
    expect(harness.state.setEnabled).not.toHaveBeenCalled();
    expect(harness.voice.speakCue).not.toHaveBeenCalled();
  });

  it("enables the session active at invocation and queues a greeting", async () => {
    const harness = createHarness("session-before");
    harness.setSessionID("session-after");

    await harness.controller.enable();

    expect(harness.state.setEnabled).toHaveBeenCalledWith("session-after", true);
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-after",
      GENERAL_GREETING,
    );
    expect(harness.toast).toHaveBeenCalledWith("Jarvis is on", "success");
  });

  it("warns without side effects when disable has no active session", async () => {
    const harness = createHarness(undefined);

    await harness.controller.disable();

    expect(harness.toast).toHaveBeenCalledWith(
      "Open a session before changing Jarvis mode",
      "warning",
    );
    expect(harness.state.setEnabled).not.toHaveBeenCalled();
    expect(harness.voice.cancelSession).not.toHaveBeenCalled();
  });

  it("disables the session active at invocation and cancels its voice", async () => {
    const harness = createHarness("session-before");
    harness.setSessionID("session-after");

    await harness.controller.disable();

    expect(harness.state.setEnabled).toHaveBeenCalledWith("session-after", false);
    expect(harness.voice.cancelSession).toHaveBeenCalledWith("session-after");
    expect(harness.toast).toHaveBeenCalledWith("Jarvis is off", "success");
  });

  it("warns without reading state when status has no active session", async () => {
    const harness = createHarness(undefined);

    await harness.controller.status();

    expect(harness.toast).toHaveBeenCalledWith(
      "Open a session before checking Jarvis mode",
      "warning",
    );
    expect(harness.state.isEnabled).not.toHaveBeenCalled();
  });

  it("reports current status for the session active at each invocation", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await harness.controller.status();
    harness.setSessionID("session-b");
    await harness.controller.status();

    expect(harness.state.isEnabled.mock.calls).toEqual([
      ["session-a"],
      ["session-b"],
    ]);
    expect(harness.toast.mock.calls).toEqual([
      ["Jarvis is on", "info"],
      ["Jarvis is off", "info"],
    ]);
  });

  it("does not let a disabled idle event poison message dedupe", async () => {
    const harness = createHarness("unrelated-active-session");
    harness.state.isEnabled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const message = assistantMessage("assistant-1", { completed: true });
    const partsFor = vi.fn((_messageID: string): readonly Part[] => [
      textPart("assistant-1", "Ready after enabling"),
    ]);

    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(partsFor).not.toHaveBeenCalled();
    expect(harness.voice.speakReply).not.toHaveBeenCalled();

    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(harness.state.isEnabled.mock.calls).toEqual([
      ["session-a"],
      ["session-a"],
    ]);
    expect(partsFor).toHaveBeenCalledOnce();
    expect(partsFor).toHaveBeenCalledWith("assistant-1");
    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-a",
      "Ready after enabling",
    );
  });

  it("suppresses an idle reply from a stale enabled read", async () => {
    const harness = createHarness("session-a");
    const enabledRead = deferred<boolean>();
    harness.state.isEnabled
      .mockReturnValueOnce(enabledRead.promise)
      .mockResolvedValue(true);
    const message = assistantMessage("assistant-stale", { completed: true });
    const partsFor = vi.fn((_messageID: string): readonly Part[] => [
      textPart("assistant-stale", "Reply after re-enabling"),
    ]);

    const idle = harness.controller.sessionIdle("session-a", [message], partsFor);
    expect(harness.state.isEnabled).toHaveBeenCalledWith("session-a");

    await harness.controller.disable();
    enabledRead.resolve(true);
    await idle;

    expect(partsFor).not.toHaveBeenCalled();
    expect(harness.voice.speakReply).not.toHaveBeenCalled();

    await harness.controller.enable();
    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(partsFor).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-a",
      "Reply after re-enabling",
    );
  });

  it("invalidates an idle enabled read when enable starts", async () => {
    const harness = createHarness("session-a");
    const enabledRead = deferred<boolean>();
    harness.state.isEnabled
      .mockReturnValueOnce(enabledRead.promise)
      .mockResolvedValue(true);
    const message = assistantMessage("assistant-before-enable", {
      completed: true,
    });
    const partsFor = vi.fn((_messageID: string): readonly Part[] => [
      textPart("assistant-before-enable", "Fresh reply"),
    ]);

    const idle = harness.controller.sessionIdle("session-a", [message], partsFor);
    await harness.controller.enable();
    enabledRead.resolve(true);
    await idle;

    expect(partsFor).not.toHaveBeenCalled();
    expect(harness.voice.speakReply).not.toHaveBeenCalled();

    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(partsFor).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-a",
      "Fresh reply",
    );
  });

  it("speaks the latest completed non-error assistant message", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    const earlier = assistantMessage("assistant-earlier", { completed: true });
    const incomplete = assistantMessage("assistant-incomplete");
    const errored = assistantMessage("assistant-errored", {
      completed: true,
      error: {
        name: "MessageAbortedError",
        data: { message: "Stopped" },
      },
    });
    const latest = assistantMessage("assistant-latest", { completed: true });
    const partsFor = vi.fn((messageID: string): readonly Part[] => [
      textPart(messageID, `Reply from ${messageID}`),
    ]);

    await harness.controller.sessionIdle(
      "session-a",
      [earlier, userMessage("user-1"), incomplete, errored, latest],
      partsFor,
    );

    expect(partsFor).toHaveBeenCalledOnce();
    expect(partsFor).toHaveBeenCalledWith("assistant-latest");
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-a",
      "Reply from assistant-latest",
    );
  });

  it("assembles reply text from ordered non-ignored nonblank text parts", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    const message = assistantMessage("assistant-1", { completed: true });
    const nonTextPart: Part = {
      id: "step-1",
      sessionID: "session-a",
      messageID: "assistant-1",
      type: "step-start",
    };
    const partsFor = vi.fn((): readonly Part[] => [
      textPart("assistant-1", "  First paragraph  "),
      nonTextPart,
      textPart("assistant-1", "Ignored", { ignored: true }),
      textPart("assistant-1", "  \n  "),
      textPart("assistant-1", " Second paragraph\n"),
    ]);

    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-a",
      "First paragraph\nSecond paragraph",
    );
  });

  it("dedupes a message only after a nonempty reply is ready", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    const message = assistantMessage("assistant-1", { completed: true });
    const partsFor = vi
      .fn<(messageID: string) => readonly Part[]>()
      .mockReturnValueOnce([textPart("assistant-1", "  ")])
      .mockReturnValue([textPart("assistant-1", "Ready")]);

    await harness.controller.sessionIdle("session-a", [message], partsFor);
    await harness.controller.sessionIdle("session-a", [message], partsFor);
    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(partsFor).toHaveBeenCalledTimes(2);
    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith("session-a", "Ready");
  });

  it("retries a message after speakReply throws synchronously", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    harness.voice.speakReply
      .mockImplementationOnce(() => {
        throw new Error("reply voice failed");
      })
      .mockImplementationOnce(() => undefined);
    const message = assistantMessage("assistant-retry", { completed: true });
    const partsFor = vi.fn((_messageID: string): readonly Part[] => [
      textPart("assistant-retry", "Retry this reply"),
    ]);

    await expect(
      harness.controller.sessionIdle("session-a", [message], partsFor),
    ).rejects.toThrow("reply voice failed");
    await harness.controller.sessionIdle("session-a", [message], partsFor);
    await harness.controller.sessionIdle("session-a", [message], partsFor);

    expect(harness.voice.speakReply).toHaveBeenCalledTimes(2);
    expect(harness.voice.speakReply).toHaveBeenLastCalledWith(
      "session-a",
      "Retry this reply",
    );
  });

  it("announces a running skill in an enabled session", async () => {
    const harness = createHarness("unrelated-active-session");
    harness.state.isEnabled.mockResolvedValue(true);
    const part = runningSkillPart("call-1", "test-driven-development");

    await harness.controller.partUpdated(part);

    expect(harness.state.isEnabled).toHaveBeenCalledWith("session-a");
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-a",
      skillLoadingCue("test-driven-development"),
    );
  });

  it("retries a skill call after speakCue throws synchronously", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    harness.voice.speakCue
      .mockImplementationOnce(() => {
        throw new Error("cue voice failed");
      })
      .mockImplementationOnce(() => undefined);
    const part = runningSkillPart("call-retry", "brainstorming");

    await expect(harness.controller.partUpdated(part)).rejects.toThrow(
      "cue voice failed",
    );
    await harness.controller.partUpdated(part);
    await harness.controller.partUpdated(part);

    expect(harness.voice.speakCue).toHaveBeenCalledTimes(2);
    expect(harness.voice.speakCue).toHaveBeenLastCalledWith(
      "session-a",
      skillLoadingCue("brainstorming"),
    );
  });

  it("suppresses a skill cue from a stale enabled read", async () => {
    const harness = createHarness("session-a");
    const enabledRead = deferred<boolean>();
    harness.state.isEnabled
      .mockReturnValueOnce(enabledRead.promise)
      .mockResolvedValue(true);
    harness.state.toggle.mockResolvedValue(false);
    const part = runningSkillPart("call-stale", "brainstorming");

    const update = harness.controller.partUpdated(part);
    expect(harness.state.isEnabled).toHaveBeenCalledWith("session-a");

    await harness.controller.toggle();
    enabledRead.resolve(true);
    await update;

    expect(harness.voice.speakCue).not.toHaveBeenCalled();

    await harness.controller.enable();
    harness.voice.speakCue.mockClear();
    await harness.controller.partUpdated(part);

    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-a",
      skillLoadingCue("brainstorming"),
    );
  });

  it("ignores invalid skill candidates without poisoning call dedupe", async () => {
    const harness = createHarness("session-a");
    harness.state.isEnabled.mockResolvedValue(true);
    const nonTool: Part = {
      id: "step-1",
      sessionID: "session-a",
      messageID: "assistant-1",
      type: "step-start",
    };
    const nonSkill: ToolPart = {
      ...runningSkillPart("call-non-skill", "bash"),
      tool: "bash",
    };
    const nonRunning: ToolPart = {
      ...runningSkillPart("call-pending", "brainstorming"),
      state: {
        status: "pending",
        input: { name: "brainstorming" },
        raw: "",
      },
    };
    const missingName: ToolPart = {
      ...runningSkillPart("call-missing", "unused"),
      state: {
        status: "running",
        input: {},
        time: { start: 1 },
      },
    };

    for (const part of [
      nonTool,
      nonSkill,
      nonRunning,
      missingName,
      runningSkillPart("call-number", 42),
      runningSkillPart("call-blank", "  \n  "),
    ]) {
      await harness.controller.partUpdated(part);
    }

    expect(harness.state.isEnabled).not.toHaveBeenCalled();
    expect(harness.voice.speakCue).not.toHaveBeenCalled();

    await harness.controller.partUpdated(
      runningSkillPart("call-non-skill", "brainstorming"),
    );

    expect(harness.state.isEnabled).toHaveBeenCalledWith("session-a");
    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-a",
      skillLoadingCue("brainstorming"),
    );
  });

  it("dedupes skill calls only after an enabled session queues the cue", async () => {
    const harness = createHarness("unrelated-active-session");
    harness.state.isEnabled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const disabledPart = runningSkillPart(
      "shared-call-id",
      "brainstorming",
      "session-disabled",
    );
    const enabledPart = runningSkillPart(
      "shared-call-id",
      "brainstorming",
      "session-enabled",
    );

    await harness.controller.partUpdated(disabledPart);
    await harness.controller.partUpdated(enabledPart);
    await harness.controller.partUpdated(enabledPart);

    expect(harness.state.isEnabled.mock.calls).toEqual([
      ["session-disabled"],
      ["session-enabled"],
      ["session-enabled"],
    ]);
    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-enabled",
      skillLoadingCue("brainstorming"),
    );
  });

  it("keeps distinct message and skill events independent across sessions", async () => {
    const harness = createHarness("active-tui-session");
    harness.state.isEnabled.mockImplementation(
      async (sessionID: string) => sessionID === "session-enabled",
    );
    const disabledMessage: AssistantMessage = {
      ...assistantMessage("assistant-disabled", { completed: true }),
      sessionID: "session-disabled",
    };
    const enabledMessage: AssistantMessage = {
      ...assistantMessage("assistant-enabled", { completed: true }),
      sessionID: "session-enabled",
    };
    const partsFor = vi.fn((messageID: string): readonly Part[] => [
      textPart(messageID, `Reply from ${messageID}`),
    ]);

    await harness.controller.sessionIdle(
      "session-disabled",
      [disabledMessage],
      partsFor,
    );
    await harness.controller.partUpdated(
      runningSkillPart("call-disabled", "brainstorming", "session-disabled"),
    );
    await harness.controller.sessionIdle(
      "session-enabled",
      [enabledMessage],
      partsFor,
    );
    await harness.controller.partUpdated(
      runningSkillPart("call-enabled", "brainstorming", "session-enabled"),
    );

    expect(harness.getSessionID).not.toHaveBeenCalled();
    expect(harness.state.isEnabled.mock.calls).toEqual([
      ["session-disabled"],
      ["session-disabled"],
      ["session-enabled"],
      ["session-enabled"],
    ]);
    expect(partsFor).toHaveBeenCalledOnce();
    expect(partsFor).toHaveBeenCalledWith("assistant-enabled");
    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      "session-enabled",
      "Reply from assistant-enabled",
    );
    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      "session-enabled",
      skillLoadingCue("brainstorming"),
    );
  });
});

describe("jarvisCommands", () => {
  it("returns the four native palette commands in order", () => {
    const actions = {
      toggle: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      status: vi.fn(),
    };

    expect(jarvisCommands(actions)).toEqual([
      {
        name: "jarvis.toggle",
        title: "Toggle Jarvis",
        desc: "Toggle Jarvis for this session",
        slashName: "jarvis",
        namespace: "palette",
        category: "Jarvis",
        run: actions.toggle,
      },
      {
        name: "jarvis.enable",
        title: "Enable Jarvis",
        desc: "Enable Jarvis for this session",
        slashName: "jarvis-on",
        namespace: "palette",
        category: "Jarvis",
        run: actions.enable,
      },
      {
        name: "jarvis.disable",
        title: "Disable Jarvis",
        desc: "Disable Jarvis for this session",
        slashName: "jarvis-off",
        namespace: "palette",
        category: "Jarvis",
        run: actions.disable,
      },
      {
        name: "jarvis.status",
        title: "Jarvis status",
        desc: "Show Jarvis state for this session",
        slashName: "jarvis-status",
        namespace: "palette",
        category: "Jarvis",
        run: actions.status,
      },
    ]);
  });
});

function createTuiApi() {
  let routeCurrent: { name: string; params?: Record<string, unknown> } = {
    name: "home",
  };
  let promptProps:
    | Parameters<TuiPluginApi["ui"]["DialogPrompt"]>[0]
    | undefined;
  let promptOnClose: (() => void) | undefined;
  const eventHandlers = new Map<string, (event: never) => void>();
  const eventUnsubscribers = new Map<string, ReturnType<typeof vi.fn>>();
  const disposeCallbacks: Array<() => void | Promise<void>> = [];
  const unregisterCommands = vi.fn();
  const registerLayer = vi.fn(
    (_layer: { commands: ReturnType<typeof jarvisCommands> }) =>
      unregisterCommands,
  );
  const toast = vi.fn();
  const clearDialog = vi.fn(() => {
    promptProps = undefined;
    promptOnClose = undefined;
  });
  const replaceDialog = vi.fn(
    (render: () => unknown, onClose?: () => void) => {
      render();
      promptOnClose = onClose;
    },
  );
  const log = vi.fn(async () => ({ data: true }));
  const messages = vi.fn((): readonly Message[] => []);
  const parts = vi.fn((): readonly Part[] => []);

  const api = {
    route: {
      get current() {
        return routeCurrent;
      },
    },
    ui: {
      DialogPrompt: vi.fn(
        (props: Parameters<TuiPluginApi["ui"]["DialogPrompt"]>[0]) => {
          promptProps = props;
          return undefined;
        },
      ),
      toast,
      dialog: {
        replace: replaceDialog,
        clear: clearDialog,
      },
    },
    keymap: { registerLayer },
    event: {
      on: vi.fn((type: string, handler: (event: never) => void) => {
        const unsubscribe = vi.fn();
        eventHandlers.set(type, handler);
        eventUnsubscribers.set(type, unsubscribe);
        return unsubscribe;
      }),
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose: vi.fn((callback: () => void | Promise<void>) => {
        disposeCallbacks.push(callback);
        return vi.fn();
      }),
    },
    state: {
      path: { state: "/state" },
      session: { messages },
      part: parts,
    },
    client: { app: { log } },
  };

  return {
    api: api as unknown as TuiPluginApi,
    setRoute(current: { name: string; params?: Record<string, unknown> }) {
      routeCurrent = current;
    },
    getPromptProps: () => promptProps,
    dismissPrompt() {
      promptOnClose?.();
    },
    eventHandlers,
    eventUnsubscribers,
    disposeCallbacks,
    unregisterCommands,
    registerLayer,
    toast,
    clearDialog,
    replaceDialog,
    log,
    messages,
    parts,
  };
}

function installTuiDependencyMocks() {
  const state = {
    isEnabled: vi.fn(async () => false),
    setEnabled: vi.fn(async (_sessionID: string, enabled: boolean) => enabled),
    toggle: vi.fn(async () => true),
  };
  const fish = {
    validateKey: vi.fn(async () => true),
    synthesize: vi.fn(),
  };
  const voice = {
    speakCue: vi.fn(),
    speakReply: vi.fn(),
    cancelSession: vi.fn(),
    dispose: vi.fn<() => Promise<void>>(async () => undefined),
  };
  const controller = {
    toggle: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    status: vi.fn(async () => undefined),
    sessionIdle: vi.fn(async () => undefined),
    partUpdated: vi.fn(async () => undefined),
  };
  const stateConstructor = vi.fn(function (_stateRoot: string) {
    return state;
  });
  const fishConstructor = vi.fn(function () {
    return fish;
  });
  const voiceConstructor = vi.fn(function (_options: {
    stateRoot: string;
    getApiKey: () => string | undefined;
    fish: typeof fish;
    report: (error: unknown) => void | Promise<void>;
  }) {
    return voice;
  });
  const createController = vi.fn(
    (_input: {
      state: typeof state;
      voice: typeof voice;
      toast: (message: string, variant: string) => void | Promise<void>;
      getSessionID: () => string | undefined;
    }) => controller,
  );

  vi.doMock("../src/state.js", () => ({
    SessionStateStore: stateConstructor,
  }));
  vi.doMock("../src/fish.js", () => ({
    FishAudioClient: fishConstructor,
  }));
  vi.doMock("../src/voice.js", () => ({ VoiceService: voiceConstructor }));
  vi.doMock("../src/controller.js", () => ({
    createJarvisController: createController,
  }));

  return {
    state,
    fish,
    voice,
    controller,
    stateConstructor,
    fishConstructor,
    voiceConstructor,
    createController,
  };
}

describe("JarvisTui", () => {
  const originalFishApiKey = process.env.FISH_API_KEY;

  afterEach(() => {
    if (originalFishApiKey === undefined) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = originalFishApiKey;
    vi.resetModules();
    vi.doUnmock("../src/state.js");
    vi.doUnmock("../src/fish.js");
    vi.doUnmock("../src/voice.js");
    vi.doUnmock("../src/controller.js");
  });

  it("uses a trimmed environment key without prompting or validating", async () => {
    process.env.FISH_API_KEY = "  environment-secret  ";
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    await JarvisTui(host.api, undefined, {} as never);

    expect(dependencies.stateConstructor).toHaveBeenCalledWith("/state");
    expect(dependencies.fishConstructor).toHaveBeenCalledOnce();
    expect(dependencies.voiceConstructor).toHaveBeenCalledOnce();
    expect(dependencies.createController).toHaveBeenCalledOnce();
    const controllerInput = dependencies.createController.mock.calls[0]?.[0];
    expect(controllerInput).toMatchObject({
      state: dependencies.state,
      voice: dependencies.voice,
    });
    expect(controllerInput?.getSessionID()).toBeUndefined();
    const voiceOptions = dependencies.voiceConstructor.mock.calls[0]?.[0];
    expect(voiceOptions).toMatchObject({
      stateRoot: "/state",
      fish: dependencies.fish,
    });
    expect(voiceOptions?.getApiKey()).toBe("environment-secret");
    expect(host.replaceDialog).not.toHaveBeenCalled();
    expect(dependencies.fish.validateKey).not.toHaveBeenCalled();
  });

  it("prompts for a missing key and retains a validated trimmed candidate", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    const prompt = host.getPromptProps();

    expect(prompt).toMatchObject({
      title: "Fish Audio API key",
      placeholder: "Enter FISH_API_KEY",
    });
    prompt?.onConfirm?.("  prompted-secret  ");
    await startup;

    expect(dependencies.fish.validateKey).toHaveBeenCalledWith(
      "prompted-secret",
      expect.any(AbortSignal),
    );
    const voiceOptions = dependencies.voiceConstructor.mock.calls[0]?.[0];
    expect(voiceOptions?.getApiKey()).toBe("prompted-secret");
    expect(host.clearDialog).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "Fish Audio is ready",
      variant: "success",
    });
  });

  it("settles a canceled key prompt with an unavailable warning", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    const prompt = host.getPromptProps();

    expect(prompt?.onCancel).toBeTypeOf("function");
    prompt?.onCancel?.();
    await startup;

    expect(dependencies.fish.validateKey).not.toHaveBeenCalled();
    const voiceOptions = dependencies.voiceConstructor.mock.calls[0]?.[0];
    expect(voiceOptions?.getApiKey()).toBeUndefined();
    expect(host.clearDialog).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "Speech is unavailable until FISH_API_KEY is configured",
      variant: "warning",
    });
  });

  it("settles a dismissed key dialog once with an unavailable warning", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    installTuiDependencyMocks();
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);

    expect(host.replaceDialog.mock.calls[0]?.[1]).toBeTypeOf("function");
    host.dismissPrompt();
    host.getPromptProps()?.onCancel?.();
    await startup;

    expect(host.clearDialog).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "Speech is unavailable until FISH_API_KEY is configured",
      variant: "warning",
    });
  });

  it("rejects an invalid prompted key without retaining it", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    dependencies.fish.validateKey.mockResolvedValue(false);
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    host.getPromptProps()?.onConfirm?.("rejected-secret");
    await startup;

    const voiceOptions = dependencies.voiceConstructor.mock.calls[0]?.[0];
    expect(voiceOptions?.getApiKey()).toBeUndefined();
    expect(host.toast).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "Fish Audio rejected that API key",
      variant: "error",
    });
  });

  it("reports validation errors and consumes log rejection", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    dependencies.fish.validateKey.mockRejectedValue(
      new Error("validation\tservice failed"),
    );
    const host = createTuiApi();
    host.log.mockRejectedValue(new Error("logging failed"));
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    host.getPromptProps()?.onConfirm?.("service-secret");
    await expect(startup).resolves.toBeUndefined();
    await Promise.resolve();

    expect(host.toast).toHaveBeenCalledOnce();
    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "validation service failed",
      variant: "error",
    });
    expect(host.log).toHaveBeenCalledOnce();
    expect(host.log).toHaveBeenCalledWith({
      service: "opencode-jarvis",
      level: "error",
      message: "validation service failed",
    });
  });

  it("registers native commands that resolve only the active session route", async () => {
    process.env.FISH_API_KEY = "environment-secret";
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    vi.doUnmock("../src/controller.js");
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    await JarvisTui(host.api, undefined, {} as never);

    expect(host.registerLayer).toHaveBeenCalledOnce();
    const layer = host.registerLayer.mock.calls[0]?.[0];
    expect(Object.keys(layer ?? {})).toEqual(["commands"]);
    const commands = layer?.commands as ReturnType<typeof jarvisCommands>;
    host.setRoute({ name: "session", params: { sessionID: "session-live" } });
    await commands[3]?.run();
    host.setRoute({ name: "home", params: { sessionID: "not-a-session" } });
    await commands[3]?.run();

    expect(dependencies.state.isEnabled).toHaveBeenCalledOnce();
    expect(dependencies.state.isEnabled).toHaveBeenCalledWith("session-live");
    expect(host.toast).toHaveBeenLastCalledWith({
      title: "Jarvis",
      message: "Open a session before checking Jarvis mode",
      variant: "warning",
    });
  });

  it("subscribes only to idle and part events and forwards current state", async () => {
    process.env.FISH_API_KEY = "environment-secret";
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const host = createTuiApi();
    const messages = [assistantMessage("assistant-event", { completed: true })];
    host.messages.mockReturnValue(messages);
    const part = runningSkillPart("event-call", "brainstorming");
    const { JarvisTui } = await import("../src/tui.js");

    await JarvisTui(host.api, undefined, {} as never);

    expect(host.api.event.on).toHaveBeenCalledTimes(2);
    expect(
      (host.api.event.on as ReturnType<typeof vi.fn>).mock.calls.map(
        ([type]) => type,
      ),
    ).toEqual(["session.idle", "message.part.updated"]);
    host.eventHandlers.get("session.idle")?.({
      properties: { sessionID: "session-event" },
    } as never);
    host.eventHandlers.get("message.part.updated")?.({
      properties: { part },
    } as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(host.messages).toHaveBeenCalledWith("session-event");
    expect(dependencies.controller.sessionIdle).toHaveBeenCalledWith(
      "session-event",
      messages,
      host.parts,
    );
    expect(dependencies.controller.partUpdated).toHaveBeenCalledWith(part);
  });

  it("reports rejected event callbacks without leaking log rejection", async () => {
    process.env.FISH_API_KEY = "environment-secret";
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    dependencies.controller.partUpdated.mockRejectedValue(
      new Error("part\ncallback failed"),
    );
    const host = createTuiApi();
    host.log.mockRejectedValue(new Error("logging failed"));
    const part = runningSkillPart("failed-call", "brainstorming");
    const { JarvisTui } = await import("../src/tui.js");

    await JarvisTui(host.api, undefined, {} as never);
    host.eventHandlers.get("message.part.updated")?.({
      properties: { part },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "part callback failed",
      variant: "error",
    });
    expect(host.log).toHaveBeenCalledWith({
      service: "opencode-jarvis",
      level: "error",
      message: "part callback failed",
    });
  });

  it("unsubscribes commands and events and awaits voice disposal", async () => {
    process.env.FISH_API_KEY = "environment-secret";
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const voiceDisposed = deferred<void>();
    dependencies.voice.dispose.mockReturnValue(voiceDisposed.promise);
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    await JarvisTui(host.api, undefined, {} as never);

    expect(host.disposeCallbacks).toHaveLength(1);
    const disposal = host.disposeCallbacks[0]?.();
    expect(host.unregisterCommands).toHaveBeenCalledOnce();
    expect(host.eventUnsubscribers.get("session.idle")).toHaveBeenCalledOnce();
    expect(
      host.eventUnsubscribers.get("message.part.updated"),
    ).toHaveBeenCalledOnce();
    expect(dependencies.voice.dispose).toHaveBeenCalledOnce();
    let disposed = false;
    void Promise.resolve(disposal).then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    voiceDisposed.resolve();
    await disposal;
    expect(disposed).toBe(true);
  });

  it("clears an owned key dialog and suppresses startup feedback on disposal", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    installTuiDependencyMocks();
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    expect(host.getPromptProps()).toBeDefined();
    await host.disposeCallbacks[0]?.();

    expect(host.clearDialog).toHaveBeenCalledOnce();
    await expect(startup).resolves.toBeUndefined();
    expect(host.toast).not.toHaveBeenCalled();
  });

  it("does not expose Fish response bodies or the prompted key", async () => {
    delete process.env.FISH_API_KEY;
    vi.resetModules();
    const dependencies = installTuiDependencyMocks();
    const fishError = new Error(
      "Fish Audio request failed (503): private upstream body service-secret",
    );
    fishError.name = "FishAudioError";
    Object.assign(fishError, { status: 503 });
    dependencies.fish.validateKey.mockRejectedValue(fishError);
    const host = createTuiApi();
    const { JarvisTui } = await import("../src/tui.js");

    const startup = JarvisTui(host.api, undefined, {} as never);
    host.getPromptProps()?.onConfirm?.("service-secret");
    await startup;

    expect(host.toast).toHaveBeenCalledWith({
      title: "Jarvis",
      message: "Fish Audio request failed (503)",
      variant: "error",
    });
    expect(host.log).toHaveBeenCalledWith({
      service: "opencode-jarvis",
      level: "error",
      message: "Fish Audio request failed (503)",
    });
    expect(JSON.stringify([host.toast.mock.calls, host.log.mock.calls])).not.toContain(
      "private upstream body",
    );
    expect(JSON.stringify([host.toast.mock.calls, host.log.mock.calls])).not.toContain(
      "service-secret",
    );
  });
});
