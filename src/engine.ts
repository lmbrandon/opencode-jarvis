import type { Plugin } from "@opencode/plugin";

import { JARVIS_SYSTEM_INSTRUCTION } from "./prompt.js";
import { JarvisRpc } from "./rpc.js";
import { SessionStateStore } from "./state.js";

interface SessionInput {
  sessionID: string;
}

interface SetInput extends SessionInput {
  enabled: boolean;
}

function storageErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Jarvis storage operation failed";
}

async function mapStorageError<T, E>(
  operation: () => Promise<T>,
  error: (message: string) => E,
): Promise<T | E> {
  try {
    return await operation();
  } catch (cause) {
    return error(storageErrorMessage(cause));
  }
}

export async function setupJarvisServer(ctx: Plugin.Context): Promise<void> {
  const state = new SessionStateStore(ctx.storage);

  await ctx.rpc.register(JarvisRpc, {
    status: async (input, context) => {
      const { sessionID } = input as SessionInput;
      return mapStorageError(
        async () => ({ enabled: await state.isEnabled(sessionID) }),
        (message) => context.error("storage_error", message, {}),
      );
    },
    set: async (input, context) => {
      const { sessionID, enabled } = input as SetInput;
      return mapStorageError(
        async () => ({ enabled: await state.setEnabled(sessionID, enabled) }),
        (message) => context.error("storage_error", message, {}),
      );
    },
    toggle: async (input, context) => {
      const { sessionID } = input as SessionInput;
      return mapStorageError(
        async () => ({ enabled: await state.toggle(sessionID) }),
        (message) => context.error("storage_error", message, {}),
      );
    },
  });

  await ctx.session.hook("context", async (event) => {
    try {
      if (await state.isEnabled(event.sessionID)) {
        event.system.push({ type: "text", text: JARVIS_SYSTEM_INSTRUCTION });
      }
    } catch {
      // Fail closed: prompt construction must continue without Jarvis.
    }
  });
}
