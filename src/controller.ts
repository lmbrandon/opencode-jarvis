import { GENERAL_GREETING, skillLoadingCue } from "./cues.js";
import { stripMarkdownForSpeech } from "./speech-text.js";

type ToastVariant = "info" | "success" | "warning" | "error";

export interface SessionRef {
  id: string;
  location: {
    directory: string;
    workspaceID?: string;
  };
}

interface ControllerInput {
  state: {
    isEnabled(session: SessionRef): Promise<boolean>;
    setEnabled(session: SessionRef, enabled: boolean): Promise<boolean>;
    toggle(session: SessionRef): Promise<boolean>;
  };
  voice: {
    speakCue(sessionID: string, text: string): void;
    speakReply(sessionID: string, text: string): void;
    cancelSession(sessionID: string): void;
  };
  toast(message: string, variant: ToastVariant): void | Promise<void>;
  getSession(): SessionRef | undefined;
}

export function createJarvisController(input: ControllerInput) {
  const spokenMessageIDs = new Set<string>();
  const announcedEventIDs = new Set<string>();
  const modeEpochs = new Map<string, number>();

  function modeEpoch(sessionID: string): number {
    return modeEpochs.get(sessionID) ?? 0;
  }

  function bumpModeEpoch(sessionID: string): void {
    modeEpochs.set(sessionID, modeEpoch(sessionID) + 1);
  }

  async function reportMode(session: SessionRef, enabled: boolean): Promise<void> {
    if (enabled) {
      input.voice.speakCue(session.id, GENERAL_GREETING);
      await input.toast("Jarvis is on", "success");
    } else {
      input.voice.cancelSession(session.id);
      await input.toast("Jarvis is off", "success");
    }
  }

  async function activeSession(warning: string): Promise<SessionRef | undefined> {
    const session = input.getSession();
    if (!session) await input.toast(warning, "warning");
    return session;
  }

  return {
    async toggle(): Promise<void> {
      const session = await activeSession(
        "Open a session before changing Jarvis mode",
      );
      if (!session) return;

      bumpModeEpoch(session.id);
      const enabled = await input.state.toggle(session);
      await reportMode(session, enabled);
    },

    async enable(): Promise<void> {
      const session = await activeSession(
        "Open a session before changing Jarvis mode",
      );
      if (!session) return;

      bumpModeEpoch(session.id);
      const enabled = await input.state.setEnabled(session, true);
      await reportMode(session, enabled);
    },

    async disable(): Promise<void> {
      const session = await activeSession(
        "Open a session before changing Jarvis mode",
      );
      if (!session) return;

      bumpModeEpoch(session.id);
      const enabled = await input.state.setEnabled(session, false);
      await reportMode(session, enabled);
    },

    async status(): Promise<void> {
      const session = await activeSession(
        "Open a session before checking Jarvis mode",
      );
      if (!session) return;

      const enabled = await input.state.isEnabled(session);
      await input.toast(`Jarvis is ${enabled ? "on" : "off"}`, "info");
    },

    async replyCompleted(
      session: SessionRef,
      messageID: string,
      reply: string,
    ): Promise<void> {
      const epoch = modeEpoch(session.id);
      const enabled = await input.state.isEnabled(session);
      if (!enabled || epoch !== modeEpoch(session.id)) return;
      if (spokenMessageIDs.has(messageID)) return;

      const text = stripMarkdownForSpeech(reply);
      if (!text) return;

      input.voice.speakReply(session.id, text);
      spokenMessageIDs.add(messageID);
    },

    async skillActivated(
      session: SessionRef,
      eventID: string,
      name: string,
    ): Promise<void> {
      if (!name.trim()) return;
      const epoch = modeEpoch(session.id);
      const enabled = await input.state.isEnabled(session);
      if (!enabled || epoch !== modeEpoch(session.id)) return;
      if (announcedEventIDs.has(eventID)) return;

      input.voice.speakCue(session.id, skillLoadingCue(name));
      announcedEventIDs.add(eventID);
    },
  };
}
