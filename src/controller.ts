import type { Message, Part } from "@opencode-ai/sdk/v2";

import { GENERAL_GREETING, skillLoadingCue } from "./cues.js";

type ToastVariant = "info" | "success" | "warning" | "error";

interface ControllerInput {
  state: {
    isEnabled(sessionID: string): Promise<boolean>;
    setEnabled(sessionID: string, enabled: boolean): Promise<boolean>;
    toggle(sessionID: string): Promise<boolean>;
  };
  voice: {
    speakCue(sessionID: string, text: string): void;
    speakReply(sessionID: string, text: string): void;
    cancelSession(sessionID: string): void;
  };
  toast(message: string, variant: ToastVariant): void | Promise<void>;
  getSessionID(): string | undefined;
}

export function createJarvisController(input: ControllerInput) {
  const spokenMessageIDs = new Set<string>();
  const announcedCallIDs = new Set<string>();

  return {
    async toggle(): Promise<void> {
      const sessionID = input.getSessionID();
      if (!sessionID) {
        await input.toast(
          "Open a session before changing Jarvis mode",
          "warning",
        );
        return;
      }

      const enabled = await input.state.toggle(sessionID);
      if (enabled) {
        input.voice.speakCue(sessionID, GENERAL_GREETING);
        await input.toast("Jarvis is on", "success");
      } else {
        input.voice.cancelSession(sessionID);
        await input.toast("Jarvis is off", "success");
      }
    },
    async enable(): Promise<void> {
      const sessionID = input.getSessionID();
      if (!sessionID) {
        await input.toast(
          "Open a session before changing Jarvis mode",
          "warning",
        );
        return;
      }

      await input.state.setEnabled(sessionID, true);
      input.voice.speakCue(sessionID, GENERAL_GREETING);
      await input.toast("Jarvis is on", "success");
    },
    async disable(): Promise<void> {
      const sessionID = input.getSessionID();
      if (!sessionID) {
        await input.toast(
          "Open a session before changing Jarvis mode",
          "warning",
        );
        return;
      }

      await input.state.setEnabled(sessionID, false);
      input.voice.cancelSession(sessionID);
      await input.toast("Jarvis is off", "success");
    },
    async status(): Promise<void> {
      const sessionID = input.getSessionID();
      if (!sessionID) {
        await input.toast(
          "Open a session before checking Jarvis mode",
          "warning",
        );
        return;
      }

      const enabled = await input.state.isEnabled(sessionID);
      await input.toast(`Jarvis is ${enabled ? "on" : "off"}`, "info");
    },
    async sessionIdle(
      sessionID: string,
      messages: readonly Message[],
      partsFor: (messageID: string) => readonly Part[],
    ): Promise<void> {
      if (!(await input.state.isEnabled(sessionID))) return;

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
          message?.role !== "assistant" ||
          message.time.completed === undefined ||
          message.error
        ) {
          continue;
        }
        if (spokenMessageIDs.has(message.id)) return;

        const text = partsFor(message.id)
          .flatMap((part) =>
            part.type === "text" && !part.ignored ? [part.text.trim()] : [],
          )
          .filter(Boolean)
          .join("\n");
        if (text) {
          spokenMessageIDs.add(message.id);
          input.voice.speakReply(sessionID, text);
        }
        return;
      }
    },
    async partUpdated(part: Part): Promise<void> {
      if (
        part.type !== "tool" ||
        part.tool !== "skill" ||
        part.state.status !== "running"
      ) {
        return;
      }
      const name = part.state.input.name;
      if (typeof name !== "string" || !name.trim()) return;
      if (!(await input.state.isEnabled(part.sessionID))) return;
      if (announcedCallIDs.has(part.callID)) return;

      announcedCallIDs.add(part.callID);
      input.voice.speakCue(part.sessionID, skillLoadingCue(name));
    },
  };
}
