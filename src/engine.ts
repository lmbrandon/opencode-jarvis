import type { Hooks, Plugin } from "@opencode-ai/plugin";

import { JARVIS_SYSTEM_INSTRUCTION } from "./prompt.js";
import { SessionStateStore } from "./state.js";

type StateReader = Pick<SessionStateStore, "isEnabled">;
type SystemInput = { sessionID?: string };
type SystemOutput = { system?: string[] };

export function createSystemTransform(state: StateReader) {
  return async (input: SystemInput, output: SystemOutput): Promise<void> => {
    if (!input.sessionID) return;
    if (!(await state.isEnabled(input.sessionID))) return;
    (output.system ??= []).push(JARVIS_SYSTEM_INSTRUCTION);
  };
}

export const JarvisEngine: Plugin = async ({ client }) => {
  // client.path.get() must not be called here: OpenCode blocks its own
  // bootstrap on this function's returned promise, with no timeout. In
  // single-process mode, the RPC routes back into that same in-flight
  // bootstrap and deadlocks forever. Resolve it lazily instead, on first
  // actual hook invocation, by which point bootstrap has already finished.
  let statePromise: Promise<SessionStateStore | undefined> | undefined;
  const resolveState = (): Promise<SessionStateStore | undefined> => {
    if (!statePromise) {
      statePromise = client.path.get().then((paths) => {
        const stateRoot = paths.data?.state;
        return stateRoot ? new SessionStateStore(stateRoot) : undefined;
      });
    }
    return statePromise;
  };
  const state: StateReader = {
    isEnabled: async (sessionID) => {
      const store = await resolveState();
      return store ? store.isEnabled(sessionID) : false;
    },
  };

  return {
    "experimental.chat.system.transform": createSystemTransform(state),
  } satisfies Hooks;
};
