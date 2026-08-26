import type {
  AssistantMessage,
  Message,
  Part,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2";
import { describe, expect, it, vi } from "vitest";

import { GENERAL_GREETING, skillLoadingCue } from "../src/cues.js";
import { createJarvisController } from "../src/controller.js";

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
