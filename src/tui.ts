import { homedir } from "node:os";

import { Plugin } from "@opencode/plugin/tui";

import { resolveCacheDirectory } from "./cache-path.js";
import {
  createJarvisController,
  type SessionRef,
} from "./controller.js";
import { FishAudioClient } from "./fish.js";
import { JarvisRpc } from "./rpc.js";
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
      id: "jarvis.toggle",
      title: "Toggle Jarvis",
      description: "Toggle Jarvis for this session",
      group: "Jarvis",
      palette: true as const,
      slash: { name: "jarvis" },
      run: actions.toggle,
    },
    {
      id: "jarvis.enable",
      title: "Enable Jarvis",
      description: "Enable Jarvis for this session",
      group: "Jarvis",
      palette: true as const,
      slash: { name: "jarvis-on" },
      run: actions.enable,
    },
    {
      id: "jarvis.disable",
      title: "Disable Jarvis",
      description: "Disable Jarvis for this session",
      group: "Jarvis",
      palette: true as const,
      slash: { name: "jarvis-off" },
      run: actions.disable,
    },
    {
      id: "jarvis.status",
      title: "Jarvis status",
      description: "Show Jarvis state for this session",
      group: "Jarvis",
      palette: true as const,
      slash: { name: "jarvis-status" },
      run: actions.status,
    },
  ];
}

function sessionRef(
  context: Plugin.Context,
  sessionID: string,
  eventLocation?: SessionRef["location"],
  allowContextFallback = false,
): SessionRef | undefined {
  const cached = context.data.session.get(sessionID);
  const location =
    eventLocation ??
    cached?.location ??
    (allowContextFallback
      ? context.location ?? context.data.location.default()
      : undefined);
  if (!location) return undefined;
  const workspaceID =
    "workspaceID" in location && typeof location.workspaceID === "string"
      ? location.workspaceID
      : undefined;
  return {
    id: sessionID,
    location: {
      directory: location.directory,
      ...(workspaceID ? { workspaceID } : {}),
    },
  };
}

function enabledResult(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  ) {
    throw new Error("Jarvis RPC returned an invalid response");
  }
  return value.enabled;
}

export async function setupJarvisTui(context: Plugin.Context) {
  const rpc = context.client.rpc(JarvisRpc);
  const environmentKey = process.env.FISH_API_KEY?.trim();
  let apiKey = environmentKey || undefined;
  let disposed = false;
  let ownsKeyPrompt = false;
  const startupController = new AbortController();
  const lifetimeController = new AbortController();
  const eventTasks = new Set<Promise<void>>();
  const fish = new FishAudioClient();
  const toast = (
    message: string,
    variant: "info" | "success" | "warning" | "error",
  ): void => context.ui.toast.show({ title: "Jarvis", message, variant });
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
    console.error(`[opencode-jarvis] ${message}`);
  };
  const voice = new VoiceService({
    cacheDirectory: resolveCacheDirectory({
      env: process.env,
      platform: process.platform,
      home: homedir(),
    }),
    getApiKey: () => apiKey,
    fish,
    report,
  });
  const ensureActive = (): void => {
    if (!disposed) return;
    const error = new Error("Jarvis terminal plugin is disposed");
    error.name = "AbortError";
    throw error;
  };
  const state = {
    async isEnabled(session: SessionRef): Promise<boolean> {
      ensureActive();
      const result = enabledResult(
        await rpc.status(
          { sessionID: session.id },
          {
            location: session.location as never,
            signal: lifetimeController.signal,
          },
        ),
      );
      ensureActive();
      return result;
    },
    async setEnabled(
      session: SessionRef,
      enabled: boolean,
    ): Promise<boolean> {
      ensureActive();
      const result = enabledResult(
        await rpc.set(
          { sessionID: session.id, enabled },
          {
            location: session.location as never,
            signal: lifetimeController.signal,
          },
        ),
      );
      ensureActive();
      return result;
    },
    async toggle(session: SessionRef): Promise<boolean> {
      ensureActive();
      const result = enabledResult(
        await rpc.toggle(
          { sessionID: session.id },
          {
            location: session.location as never,
            signal: lifetimeController.signal,
          },
        ),
      );
      ensureActive();
      return result;
    },
  };
  const controller = createJarvisController({
    state,
    voice,
    toast,
    getSession: () => {
      const route = context.ui.router.current();
      return route.type === "session"
        ? sessionRef(context, route.sessionID, undefined, true)
        : undefined;
    },
  });
  const guard = (action: () => Promise<void>) => async (): Promise<void> => {
    try {
      await action();
    } catch (error) {
      report(error);
    }
  };
  const trackEvent = (task: Promise<void>): void => {
    const handled = task.catch(report);
    eventTasks.add(handled);
    void handled.finally(() => eventTasks.delete(handled));
  };

  context.keymap.layer(() => ({
    mode: "global",
    commands: jarvisCommands({
      toggle: guard(controller.toggle),
      enable: guard(controller.enable),
      disable: guard(controller.disable),
      status: guard(controller.status),
    }),
  }));

  const stopExecution = context.data.on(
    "session.execution.succeeded",
    (event) => {
      if (disposed) return;
      trackEvent((async () => {
        const session = sessionRef(
          context,
          event.data.sessionID,
          event.location,
        );
        if (!session) return;
        await context.data.session.message.sync(session.id);
        ensureActive();
        const messages = context.data.session.message.list(session.id);
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (
            !message ||
            message.type !== "assistant" ||
            !message.time.completed ||
            message.error
          ) {
            continue;
          }
          const text = message.content
            .flatMap((part) =>
              part.type === "text" && part.text.trim()
                ? [part.text.trim()]
                : [],
            )
            .join("\n");
          await controller.replyCompleted(session, message.id, text);
          return;
        }
      })());
    },
  );
  const stopSkill = context.data.on("session.skill.activated", (event) => {
    if (disposed) return;
    const session = sessionRef(
      context,
      event.data.sessionID,
      event.location,
    );
    if (!session) return;
    trackEvent(controller.skillActivated(session, event.id, event.data.name));
  });

  let startupTask = Promise.resolve();
  if (!apiKey) {
    startupTask = (async () => {
      ownsKeyPrompt = true;
      const candidate = (
        await context.ui.dialog.prompt({
          title: "Fish Audio API key",
          placeholder: "Enter FISH_API_KEY",
        })
      )?.trim();
      ownsKeyPrompt = false;
      if (disposed) return;
      if (!candidate) {
        toast(
          "Speech is unavailable until FISH_API_KEY is configured",
          "warning",
        );
        return;
      }
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
        if (!startupController.signal.aborted) report(error, candidate);
      }
    })().catch(report);
  }

  let cleanupTask: Promise<void> | undefined;
  return (): Promise<void> => {
    if (cleanupTask) return cleanupTask;
    disposed = true;
    startupController.abort();
    lifetimeController.abort();
    if (ownsKeyPrompt) context.ui.dialog.clear();
    stopExecution();
    stopSkill();
    cleanupTask = Promise.all([
      startupTask,
      ...eventTasks,
      voice.dispose(),
    ]).then(() => undefined);
    return cleanupTask;
  };
}

export default Plugin.define({
  id: "opencode-jarvis.tui",
  setup: setupJarvisTui,
});
