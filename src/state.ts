import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface StateData {
  sessions: Record<string, true>;
}

export class SessionStateStore {
  private readonly stateDirectory: string;
  private readonly stateFile: string;
  private pendingMutations: Promise<void> = Promise.resolve();

  constructor(stateRoot: string) {
    this.stateDirectory = join(stateRoot, "opencode-jarvis");
    this.stateFile = join(this.stateDirectory, "state.json");
  }

  async isEnabled(sessionID: string): Promise<boolean> {
    await this.pendingMutations;
    const state = await this.readState();
    return state.sessions[sessionID] === true;
  }

  setEnabled(sessionID: string, enabled: boolean): Promise<boolean> {
    return this.mutate(async () => {
      const state = await this.readState();

      if (enabled) {
        state.sessions[sessionID] = true;
      } else {
        delete state.sessions[sessionID];
      }

      await this.writeState(state);
      return enabled;
    });
  }

  toggle(sessionID: string): Promise<boolean> {
    return this.mutate(async () => {
      const state = await this.readState();
      const enabled = state.sessions[sessionID] !== true;

      if (enabled) {
        state.sessions[sessionID] = true;
      } else {
        delete state.sessions[sessionID];
      }

      await this.writeState(state);
      return enabled;
    });
  }

  private mutate<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.pendingMutations.then(mutation);
    this.pendingMutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readState(): Promise<StateData> {
    try {
      const data: unknown = JSON.parse(await readFile(this.stateFile, "utf8"));

      if (
        typeof data !== "object" ||
        data === null ||
        !("sessions" in data) ||
        typeof data.sessions !== "object" ||
        data.sessions === null ||
        Array.isArray(data.sessions)
      ) {
        return { sessions: {} };
      }

      return {
        sessions: Object.fromEntries(
          Object.entries(data.sessions).filter(([, enabled]) => enabled === true),
        ) as Record<string, true>,
      };
    } catch {
      return { sessions: {} };
    }
  }

  private async writeState(state: StateData): Promise<void> {
    await mkdir(this.stateDirectory, { recursive: true });
    const temporaryFile = join(
      this.stateDirectory,
      `.state.json.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryFile, JSON.stringify(state), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryFile, this.stateFile);
    } finally {
      await rm(temporaryFile, { force: true });
    }
  }
}
