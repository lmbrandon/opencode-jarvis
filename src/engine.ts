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
  const paths = await client.path.get();
  const stateRoot = paths.data?.state;
  if (!stateRoot) return {};

  const state = new SessionStateStore(stateRoot);
  return {
    "experimental.chat.system.transform": createSystemTransform(state),
  } satisfies Hooks;
};
