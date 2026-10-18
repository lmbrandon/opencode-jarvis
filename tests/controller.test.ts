import { describe, expect, it, vi } from "vitest";

import {
  createJarvisController,
  type SessionRef,
} from "../src/controller.js";
import { GENERAL_GREETING, skillLoadingCue } from "../src/cues.js";

const sessionA: SessionRef = {
  id: "session-a",
  location: { directory: "/workspace/a", workspaceID: "workspace-a" },
};
const sessionB: SessionRef = {
  id: "session-b",
  location: { directory: "/workspace/b" },
};

function createHarness(initialSession: SessionRef | undefined) {
  let session = initialSession;
  const state = {
    isEnabled: vi.fn(async (_session: SessionRef) => false),
    setEnabled: vi.fn(async (_session: SessionRef, enabled: boolean) => enabled),
    toggle: vi.fn(async (_session: SessionRef) => true),
  };
  const voice = {
    speakCue: vi.fn(),
    speakReply: vi.fn(),
    cancelSession: vi.fn(),
  };
  const toast = vi.fn();
  const getSession = vi.fn(() => session);
  const controller = createJarvisController({ state, voice, toast, getSession });

  return {
    controller,
    state,
    voice,
    toast,
    getSession,
    setSession(next: SessionRef | undefined) {
      session = next;
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
  it("returns command actions and normalized event handlers", () => {
    const { controller } = createHarness(sessionA);

    expect(controller).toEqual({
      toggle: expect.any(Function),
      enable: expect.any(Function),
      disable: expect.any(Function),
      status: expect.any(Function),
      replyCompleted: expect.any(Function),
      skillActivated: expect.any(Function),
    });
  });

  it("warns without side effects when no session is active", async () => {
    const harness = createHarness(undefined);

    await harness.controller.toggle();
    await harness.controller.enable();
    await harness.controller.disable();
    await harness.controller.status();

    expect(harness.state.toggle).not.toHaveBeenCalled();
    expect(harness.state.setEnabled).not.toHaveBeenCalled();
    expect(harness.state.isEnabled).not.toHaveBeenCalled();
    expect(harness.voice.speakCue).not.toHaveBeenCalled();
    expect(harness.voice.cancelSession).not.toHaveBeenCalled();
    expect(harness.toast.mock.calls).toEqual([
      ["Open a session before changing Jarvis mode", "warning"],
      ["Open a session before changing Jarvis mode", "warning"],
      ["Open a session before changing Jarvis mode", "warning"],
      ["Open a session before checking Jarvis mode", "warning"],
    ]);
  });

  it("resolves the active session for each command", async () => {
    const harness = createHarness(sessionA);

    await harness.controller.enable();
    harness.setSession(sessionB);
    await harness.controller.status();

    expect(harness.state.setEnabled).toHaveBeenCalledWith(sessionA, true);
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      sessionA.id,
      GENERAL_GREETING,
    );
    expect(harness.state.isEnabled).toHaveBeenCalledWith(sessionB);
  });

  it("toggles on with a greeting and toggles off with cancellation", async () => {
    const harness = createHarness(sessionA);
    harness.state.toggle.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await harness.controller.toggle();
    await harness.controller.toggle();

    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      sessionA.id,
      GENERAL_GREETING,
    );
    expect(harness.voice.cancelSession).toHaveBeenCalledWith(sessionA.id);
    expect(harness.toast.mock.calls).toEqual([
      ["Jarvis is on", "success"],
      ["Jarvis is off", "success"],
    ]);
  });

  it("disables and cancels the active session", async () => {
    const harness = createHarness(sessionA);

    await harness.controller.disable();

    expect(harness.state.setEnabled).toHaveBeenCalledWith(sessionA, false);
    expect(harness.voice.cancelSession).toHaveBeenCalledWith(sessionA.id);
  });

  it("uses the server-confirmed state for enable and disable feedback", async () => {
    const harness = createHarness(sessionA);
    harness.state.setEnabled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await harness.controller.enable();
    await harness.controller.disable();

    expect(harness.voice.cancelSession).toHaveBeenCalledWith(sessionA.id);
    expect(harness.voice.speakCue).toHaveBeenCalledWith(
      sessionA.id,
      GENERAL_GREETING,
    );
    expect(harness.toast.mock.calls).toEqual([
      ["Jarvis is off", "success"],
      ["Jarvis is on", "success"],
    ]);
  });

  it("speaks one sanitized completed reply per message ID", async () => {
    const harness = createHarness(sessionA);
    harness.state.isEnabled.mockResolvedValue(true);

    await harness.controller.replyCompleted(
      sessionA,
      "message-1",
      "Hello **sir**\n```ts\nconst ignored = true\n```",
    );
    await harness.controller.replyCompleted(sessionA, "message-1", "Duplicate");

    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(
      sessionA.id,
      "Hello sir",
    );
  });

  it("does not let disabled or empty replies poison message deduplication", async () => {
    const harness = createHarness(sessionA);
    harness.state.isEnabled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await harness.controller.replyCompleted(sessionA, "message-1", "Ready");
    await harness.controller.replyCompleted(sessionA, "message-1", "```ts\nx\n```");
    await harness.controller.replyCompleted(sessionA, "message-1", "Ready");

    expect(harness.voice.speakReply).toHaveBeenCalledOnce();
    expect(harness.voice.speakReply).toHaveBeenCalledWith(sessionA.id, "Ready");
  });

  it("suppresses a reply after its mode epoch changes", async () => {
    const harness = createHarness(sessionA);
    const enabled = deferred<boolean>();
    harness.state.isEnabled.mockReturnValueOnce(enabled.promise);

    const reply = harness.controller.replyCompleted(
      sessionA,
      "message-stale",
      "Stale reply",
    );
    await harness.controller.disable();
    enabled.resolve(true);
    await reply;

    expect(harness.voice.speakReply).not.toHaveBeenCalled();
  });

  it("announces distinct activations of the same skill", async () => {
    const harness = createHarness(sessionA);
    harness.state.isEnabled.mockResolvedValue(true);

    await harness.controller.skillActivated(
      sessionA,
      "event-1",
      "brainstorming",
    );
    await harness.controller.skillActivated(
      sessionA,
      "event-2",
      "brainstorming",
    );

    expect(harness.voice.speakCue).toHaveBeenCalledTimes(2);
    expect(harness.voice.speakCue).toHaveBeenNthCalledWith(
      1,
      sessionA.id,
      skillLoadingCue("brainstorming"),
    );
    expect(harness.voice.speakCue).toHaveBeenNthCalledWith(
      2,
      sessionA.id,
      skillLoadingCue("brainstorming"),
    );
  });

  it("deduplicates skill activations by event envelope ID", async () => {
    const harness = createHarness(sessionA);
    harness.state.isEnabled.mockResolvedValue(true);

    await harness.controller.skillActivated(sessionA, "event-1", "brainstorming");
    await harness.controller.skillActivated(sessionA, "event-1", "different-name");

    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
  });

  it("does not let disabled or invalid skill events poison deduplication", async () => {
    const harness = createHarness(sessionA);
    harness.state.isEnabled
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await harness.controller.skillActivated(sessionA, "event-1", "brainstorming");
    await harness.controller.skillActivated(sessionA, "event-1", "  ");
    await harness.controller.skillActivated(sessionA, "event-1", "brainstorming");

    expect(harness.voice.speakCue).toHaveBeenCalledOnce();
  });

  it("suppresses a skill cue after its mode epoch changes", async () => {
    const harness = createHarness(sessionA);
    const enabled = deferred<boolean>();
    harness.state.isEnabled.mockReturnValueOnce(enabled.promise);

    const activation = harness.controller.skillActivated(
      sessionA,
      "event-stale",
      "brainstorming",
    );
    await harness.controller.enable();
    harness.voice.speakCue.mockClear();
    enabled.resolve(true);
    await activation;

    expect(harness.voice.speakCue).not.toHaveBeenCalled();
  });
});
