import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

import { createJarvisController } from "./controller.js";
import { FishAudioClient } from "./fish.js";
import { SessionStateStore } from "./state.js";
import { VoiceService } from "./voice.js";

interface JarvisActions {
  toggle(): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  status(): Promise<void>;
}

export function jarvisCommands(actions: JarvisActions) {
  return [
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
  ];
}

export const JarvisTui: TuiPlugin = async (api) => {
  const environmentKey = process.env.FISH_API_KEY?.trim();
  let apiKey = environmentKey || undefined;
  const startupController = new AbortController();
  let startupTask = Promise.resolve();
  let disposed = false;
  let closeKeyDialog: (() => void) | undefined;
  const stateRoot = api.state.path.state;
  const state = new SessionStateStore(stateRoot);
  const fish = new FishAudioClient();
  const toast = (
    message: string,
    variant: "info" | "success" | "warning" | "error",
  ): void => {
    api.ui.toast({ title: "Jarvis", message, variant });
  };
  const report = (error: unknown, sensitive?: string): void => {
    if (disposed) return;
    let message =
      error instanceof Error &&
      error.name === "FishAudioError" &&
      "status" in error &&
      typeof error.status === "number"
        ? `Fish Audio request failed (${error.status})`
        : error instanceof Error
          ? error.message
          : "Unexpected Jarvis error";
    for (const secret of [apiKey, sensitive]) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
    message = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (!message) message = "Unexpected Jarvis error";

    toast(message, "error");
    try {
      void api.client.app
        .log({ service: "opencode-jarvis", level: "error", message })
        .catch(() => undefined);
    } catch {}
  };
  const voice = new VoiceService({
    stateRoot,
    getApiKey: () => apiKey,
    fish,
    report,
  });
  const controller = createJarvisController({
    state,
    voice,
    toast,
    getSessionID: () => {
      const route = api.route.current;
      return route.name === "session" &&
        route.params &&
        typeof route.params.sessionID === "string"
        ? route.params.sessionID
        : undefined;
    },
  });
  const guardCommand =
    (action: () => Promise<void>) => async (): Promise<void> => {
      try {
        await action();
      } catch (error) {
        report(error);
      }
    };
  const unregisterCommands = api.keymap.registerLayer({
    commands: jarvisCommands({
      toggle: guardCommand(controller.toggle),
      enable: guardCommand(controller.enable),
      disable: guardCommand(controller.disable),
      status: guardCommand(controller.status),
    }),
  });
  const unsubscribeIdle = api.event.on("session.idle", (event) => {
    const sessionID = event.properties.sessionID;
    void Promise.resolve()
      .then(() =>
        controller.sessionIdle(
          sessionID,
          api.state.session.messages(sessionID),
          api.state.part,
        ),
      )
      .catch(report);
  });
  const unsubscribePart = api.event.on("message.part.updated", (event) => {
    void Promise.resolve()
      .then(() => controller.partUpdated(event.properties.part))
      .catch(report);
  });
  api.lifecycle.onDispose(async () => {
    disposed = true;
    startupController.abort();
    closeKeyDialog?.();
    unregisterCommands();
    unsubscribeIdle();
    unsubscribePart();
    await Promise.all([startupTask, voice.dispose()]);
  });

  if (!apiKey) {
    startupTask = (async () => {
      const candidate = await new Promise<string | undefined>((resolve) => {
        let settled = false;
        let ownsDialog = true;
        const settle = (
          value: string | undefined,
          clearOwnedDialog = true,
        ): void => {
          if (settled) return;
          settled = true;
          closeKeyDialog = undefined;
          const shouldClear = clearOwnedDialog && ownsDialog;
          ownsDialog = false;
          if (shouldClear) api.ui.dialog.clear();
          resolve(value);
        };
        closeKeyDialog = () => settle(undefined);

        api.ui.dialog.replace(
          () =>
            api.ui.DialogPrompt({
              title: "Fish Audio API key",
              placeholder: "Enter FISH_API_KEY",
              onConfirm: (value) => settle(value.trim() || undefined),
              onCancel: () => settle(undefined),
            }),
          () => settle(undefined, false),
        );
      });

      if (disposed) return;
      if (!candidate) {
        toast(
          "Speech is unavailable until FISH_API_KEY is configured",
          "warning",
        );
      } else {
        try {
          const valid = await fish.validateKey(
            candidate,
            startupController.signal,
          );
          if (disposed) return;
          if (valid) {
            apiKey = candidate;
            toast("Fish Audio is ready", "success");
          } else {
            toast("Fish Audio rejected that API key", "error");
          }
        } catch (error) {
          report(error, candidate);
        }
      }
    })().catch(report);
  }
};

export default {
  id: "opencode-jarvis",
  tui: JarvisTui,
} satisfies TuiPluginModule;
